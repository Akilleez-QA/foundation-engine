/**
 * The Lua sandbox prelude, run once per script state before the script and before the memory cap applies. It receives
 * the budget sentinel, whether pattern matching is allowed, the host's random source and the meter that charges native
 * library work to the instruction budget, and leaves only deterministic, budgeted functions reachable. The libraries `io`, `os`, `debug`, `package` and `coroutine` are never opened.
 */
export const SANDBOX_PRELUDE = String.raw`
local SENTINEL, allow_patterns, host_random, meter = ...
local type, error, rawequal, rawget, rawnext, select = type, error, rawequal, rawget, next, select
local rawpcall, rawxpcall, rawsetmetatable, getmetatable = pcall, xpcall, setmetatable, getmetatable
local rawtostring, sort, floor, tointeger = tostring, table.sort, math.floor, math.tointeger
local string_find, string_format = string.find, string.format

-- A budget stop must not be swallowed: pcall and xpcall re-raise it.
local function pass(ok, ...)
  if not ok and rawequal((...), SENTINEL) then error(SENTINEL, 0) end
  return ok, ...
end
pcall = function(f, ...) return pass(rawpcall(f, ...)) end
xpcall = function(f, handler, ...)
  return pass(rawxpcall(f, function(e)
    if rawequal(e, SENTINEL) then return e end
    return handler(e)
  end, ...))
end

-- Deterministic iteration: keys are visited in a fixed order (numbers, then strings, then false, true).
local function rank(k)
  local t = type(k)
  if t == 'number' then return 1 elseif t == 'string' then return 2 elseif t == 'boolean' then return 3 end
  error('pairs: keys must be numbers, strings or booleans for a deterministic order', 3)
end
local function before(a, b)
  local ra, rb = rank(a), rank(b)
  if ra ~= rb then return ra < rb end
  if ra == 3 then return (not a) and b end
  return a < b
end
pairs = function(t)
  if type(t) ~= 'table' then error("bad argument #1 to 'pairs' (table expected)", 2) end
  local keys, n = {}, 0
  local k = rawnext(t)
  while k ~= nil do n = n + 1; keys[n] = k; k = rawnext(t, k) end
  sort(keys, before)
  local i = 0
  return function()
    i = i + 1
    local key = keys[i]
    if key ~= nil then return key, rawget(t, key) end
  end
end
next = nil

-- Addresses are not observable.
local opaque = {table = true, ['function'] = true, userdata = true, thread = true}
tostring = function(v)
  local t = type(v)
  if opaque[t] then
    local mt = getmetatable(v)
    if type(mt) == 'table' and rawget(mt, '__tostring') ~= nil then return rawtostring(v) end
    return t
  end
  return rawtostring(v)
end
string.format = function(f, ...)
  if type(f) == 'string' and string_find(f, '%p', 1, true) then
    error("bad argument #1 to 'format' (%p is not available)", 2)
  end
  local n = select('#', ...)
  if n == 0 then return string_format(f) end
  local args = {...}
  for i = 1, n do
    if opaque[type(args[i])] then args[i] = tostring(args[i]) end
  end
  return string_format(f, table.unpack(args, 1, n))
end

-- Finalisers and weak tables run at collection times that are not reproducible.
-- A table gets a private copy of its metatable, so adding __gc or __mode to the metatable later has no effect;
-- getmetatable still returns the table the script passed. (Metamethods added after setmetatable are not seen.)
local origin = rawsetmetatable({}, {__mode = 'k'})
setmetatable = function(t, mt)
  if type(mt) ~= 'table' then return rawsetmetatable(t, mt) end
  if rawget(mt, '__gc') ~= nil or rawget(mt, '__mode') ~= nil then
    error('setmetatable: __gc and __mode are not available in scripts', 2)
  end
  local copy = {}
  local k, v = rawnext(mt)
  while k ~= nil do copy[k] = v; k, v = rawnext(mt, k) end
  rawsetmetatable(t, copy)
  origin[copy] = mt
  return t
end
local rawgetmetatable = getmetatable
_ENV.getmetatable = function(v)
  local m = rawgetmetatable(v)
  if m == nil then return nil end
  local o = origin[m]
  if o ~= nil then return o end
  return m
end

-- Random numbers come from the host's saveable stream.
local TWO32 = 4294967296
math.random = function(m, n)
  local r = host_random()
  if m == nil then return r end
  if m == 0 and n == nil then return (floor(r * TWO32) << 32) | floor(host_random() * TWO32) end
  if n == nil then m, n = 1, m end
  m, n = tointeger(m), tointeger(n)
  if m == nil or n == nil then error("bad argument to 'random' (number has no integer representation)", 2) end
  if m > n then error("bad argument to 'random' (interval is empty)", 2) end
  if n - m < 0 or n - m >= 9007199254740992 then error("bad argument to 'random' (interval is too large)", 2) end
  return m + floor(r * (n - m + 1))
end
math.randomseed = nil

-- Native pattern matching cannot be interrupted by the instruction budget, so it is off unless the creator allows it.
if not allow_patterns then
  string.find = function(s, p, init, plain)
    if plain ~= true then error("string.find: patterns are disabled; pass plain = true", 2) end
    return string_find(s, p, init, true)
  end
  string.match, string.gmatch, string.gsub = nil, nil, nil
end

string.dump = nil
dofile, loadfile, load, print, collectgarbage, warn, require = nil, nil, nil, nil, nil, nil, nil

-- Native library calls are charged to the instruction budget by the data they touch (the meter charges one
-- instruction per 16 bytes or elements), so a loop over large strings or tables runs out of budget, not wall time.
local function size(x) if type(x) == 'string' then return #x end return 32 end
local rawlen = rawlen
local function count(t) if type(t) == 'table' then return rawlen(t) end return 0 end
local function after(f) return function(...) local r = f(...) meter(size(r)) return r end end
local function before(f, cost) return function(...) meter(cost(...)) return f(...) end end
local string_rep = string.rep
string.rep = function(s, n, sep)
  local unit = size(s) + (sep == nil and 0 or size(sep))
  if type(n) == 'number' then
    if unit == 0 or n <= 0 then return string_rep(s, 0) end
    meter(unit * (n + 0.0))
  end
  return string_rep(s, n, sep)
end
for _, name in ipairs({'sub', 'upper', 'lower', 'reverse', 'format', 'char'}) do string[name] = after(string[name]) end
for _, name in ipairs({'find', 'byte', 'pack', 'unpack', 'match', 'gmatch', 'gsub'}) do
  if string[name] then string[name] = before(string[name], function(s, p) return size(s) + size(p) end) end
end
for _, name in ipairs({'len', 'codepoint', 'offset', 'codes'}) do
  utf8[name] = before(utf8[name], function(s) return size(s) end)
end
utf8.char = after(utf8.char)
table.concat = after(table.concat)
for _, name in ipairs({'insert', 'remove'}) do table[name] = before(table[name], count) end
local table_sort = table.sort
table.sort = function(t, cmp)
  local n = count(t)
  meter(n * 16 * (n > 1 and math.log(n, 2) or 1))
  return table_sort(t, cmp)
end
local table_unpack = table.unpack
table.unpack = function(t, i, j)
  local first, last = i or 1, j or count(t)
  if type(first) == 'number' and type(last) == 'number' and last >= first then meter((last - first + 1) * 16) end
  return table_unpack(t, i, j)
end
-- Moves element by element in Lua, so every step is an ordinary budgeted instruction.
table.move = function(a1, f, e, t, a2)
  if a2 == nil then a2 = a1 end
  f, e, t = tointeger(f), tointeger(e), tointeger(t)
  if f == nil or e == nil or t == nil then error("bad argument to 'move' (number has no integer representation)", 2) end
  if e >= f then
    if t > e or t <= f or not rawequal(a1, a2) then
      for i = 0, e - f do a2[t + i] = a1[f + i] end
    else
      for i = e - f, 0, -1 do a2[t + i] = a1[f + i] end
    end
  end
  return a2
end
`;
