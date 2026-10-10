/**
 * The Lua sandbox prelude, run once per script state before the script and before the memory cap applies. It receives
 * the budget sentinel, whether pattern matching is allowed and the host's random source, and leaves only deterministic,
 * interruptible functions reachable. The libraries `io`, `os`, `debug`, `package` and `coroutine` are never opened.
 */
export const SANDBOX_PRELUDE = String.raw`
local SENTINEL, allow_patterns, host_random = ...
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
setmetatable = function(t, mt)
  if type(mt) == 'table' and (rawget(mt, '__gc') ~= nil or rawget(mt, '__mode') ~= nil) then
    error('setmetatable: __gc and __mode are not available in scripts', 2)
  end
  return rawsetmetatable(t, mt)
end

-- Random numbers come from the host's saveable stream.
math.random = function(m, n)
  local r = host_random()
  if m == nil then return r end
  if n == nil then m, n = 1, m end
  m, n = tointeger(m), tointeger(n)
  if m == nil or n == nil then error("bad argument to 'random' (number has no integer representation)", 2) end
  if m > n then error("bad argument to 'random' (interval is empty)", 2) end
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
`;
