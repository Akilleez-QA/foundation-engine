from __future__ import annotations
import json
import re
import sys
from pathlib import Path
from typing import BinaryIO
ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / "schemas/read-only-tools.json").read_text())
TOOLS = {tool["name"]: tool for tool in CONTRACT["tools"]}
__version__ = CONTRACT["version"]
PROTOCOL = "foundation-engine-jsonrpc/1"
MAX_FRAME_BYTES = 65536
MAX_OUTPUT_BYTES = 1048576
MAX_JSON_DEPTH = 32
MAX_JSON_NODES = 4096
MAX_STRING_CHARS = 1024
MAX_NUMBER_CHARS = 24
MAX_ID_CHARS = 128
MAX_ID_INTEGER = 9007199254740991
_DECIMAL = re.compile(r"-?(0|[1-9][0-9]*)\.[0-9]+\Z")
class WireError(ValueError):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
def _error(identifier, code, message):
    return {"jsonrpc": "2.0", "id": identifier, "error": {"code": code, "message": message}}
def _scan_depth(text):
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise WireError(-32002, "JSON nesting exceeds bridge limit")
        elif char in "]}":
            depth -= 1
def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise WireError(-32700, "Duplicate JSON object keys are rejected")
        result[key] = value
    return result
def _decimal(token):
    if len(token) > MAX_NUMBER_CHARS or _DECIMAL.fullmatch(token) is None:
        raise WireError(-32700, "Numbers must be finite decimal literals without exponent")
    return float(token)
def _integer(token):
    if len(token.lstrip("-")) > 15:
        raise WireError(-32002, "JSON integer exceeds bridge limit")
    return int(token)
def _no_constant(token):
    raise WireError(-32700, "NaN and Infinity are outside the engine numeric profile")
def decode_frame(data: bytes):
    if len(data) > MAX_FRAME_BYTES:
        raise WireError(-32002, "Input frame exceeds bridge byte limit")
    try:
        text = data.decode("utf-8", errors="strict")
        _scan_depth(text)
        value = json.loads(text, object_pairs_hook=_unique, parse_int=_integer, parse_float=_decimal,
                           parse_constant=_no_constant)
    except WireError:
        raise
    except (ValueError, RecursionError, OverflowError):
        raise WireError(-32700, "Malformed UTF-8 JSON frame") from None
    stack, nodes = [value], 0
    while stack:
        item = stack.pop()
        nodes += 1
        if nodes > MAX_JSON_NODES:
            raise WireError(-32002, "JSON node count exceeds bridge limit")
        if type(item) is dict:
            stack.extend(item.keys())
            stack.extend(item.values())
        elif type(item) is list:
            stack.extend(item)
        elif type(item) is str and len(item) > MAX_STRING_CHARS:
            raise WireError(-32002, "JSON string exceeds bridge limit")
    return value
def _exact_object(value, fields):
    if type(value) is not dict or set(value) != fields:
        raise WireError(-32602, "Invalid parameter fields")
    return value
def _validate(value, schema):
    if "enum" in schema and value not in schema["enum"]:
        raise WireError(-32602, "Value outside schema enum")
    kind = schema.get("type")
    if kind == "object":
        if type(value) is not dict:
            raise WireError(-32602, "Expected schema object")
        properties = schema["properties"]
        if set(value) - properties.keys() or set(schema.get("required", [])) - value.keys():
            raise WireError(-32602, "Invalid schema fields")
        for key, item in value.items():
            _validate(item, properties[key])
    elif kind in ("integer", "number"):
        if type(value) not in ((int,) if kind == "integer" else (int, float)):
            raise WireError(-32602, "Expected schema number")
        if (("minimum" in schema and value < schema["minimum"]) or
                ("maximum" in schema and value > schema["maximum"]) or
                ("exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"])):
            raise WireError(-32602, "Number outside schema bounds")
    elif kind is not None:
        raise WireError(-32603, "Unsupported pinned schema type")
def _tool_result(name, arguments):
    _validate(arguments, TOOLS[name]["inputSchema"])
    if name == "validate_render_mask":
        result = arguments["mask"]
    else:
        output = arguments.get("output", {})
        result = {"toneMapping": output.get("toneMapping", "none"), "exposure": output.get("exposure", 1)}
    _validate(result, TOOLS[name]["outputSchema"])
    return {"isError": False, "structuredContent": result}
class Bridge:
    def __init__(self):
        self.initialized = False
    def dispatch(self, message):
        if type(message) is not dict or set(message) - {"jsonrpc", "id", "method", "params"}:
            return _error(None, -32600, "Expected a single request object; batches and extra fields are unsupported")
        if message.get("jsonrpc") != "2.0" or type(message.get("method")) is not str or not message["method"]:
            return _error(None, -32600, "Invalid JSON-RPC request envelope")
        identifier = message.get("id")
        if "id" in message and not ((type(identifier) is str and len(identifier) <= MAX_ID_CHARS) or
                                     (type(identifier) is int and abs(identifier) <= MAX_ID_INTEGER)):
            return _error(None, -32600, "Request id must be a bounded string or safe integer; null is unsupported")
        if "id" not in message:
            return None
        try:
            method, params = message["method"], message.get("params", {})
            if method == "ping":
                _exact_object(params, set())
                result = {}
            elif method == "initialize":
                fields = _exact_object(params, {"protocolVersion"})
                if fields["protocolVersion"] != PROTOCOL:
                    raise WireError(-32001, "Unsupported bridge protocol; expected " + PROTOCOL + " (not MCP)")
                if self.initialized:
                    raise WireError(-32000, "Bridge already initialized")
                self.initialized = True
                result = {"protocolVersion": PROTOCOL,
                          "serverInfo": {"name": "foundation-engine-jsonrpc-bridge", "version": __version__},
                          "capabilities": {"tools": True}, "mcpCompatible": False,
                          "limits": {"inputFrameBytes": MAX_FRAME_BYTES, "outputFrameBytes": MAX_OUTPUT_BYTES,
                                     "jsonDepth": MAX_JSON_DEPTH, "jsonNodes": MAX_JSON_NODES,
                                     "stringCharacters": MAX_STRING_CHARS, "numberCharacters": MAX_NUMBER_CHARS,
                                     "idCharacters": MAX_ID_CHARS, "idIntegerAbsoluteValue": MAX_ID_INTEGER},
                          "numericProfile": "finite decimal literals with explicit units; no exponent, NaN or Infinity",
                          "methods": ["initialize", "ping", "tools/list", "tools/call"],
                          "execution": "sequential, request-only; close stdin to stop; no cancellation, batches, "
                                       "MCP, control actions or determinations"}
            elif method not in ("tools/list", "tools/call"):
                raise WireError(-32601, "Method not found")
            elif not self.initialized:
                raise WireError(-32000, "Initialize the bridge before using tools")
            elif method == "tools/list":
                _exact_object(params, set())
                result = {"tools": CONTRACT["tools"]}
            else:
                fields = _exact_object(params, {"name", "arguments"})
                name, arguments = fields["name"], fields["arguments"]
                if type(name) is not str or name not in TOOLS:
                    raise WireError(-32602, "Unknown engine tool")
                if type(arguments) is not dict:
                    raise WireError(-32602, "Tool arguments must be a JSON object")
                result = _tool_result(name, arguments)
            return {"jsonrpc": "2.0", "id": identifier, "result": result}
        except WireError as error:
            return _error(identifier, error.code, str(error))
        except Exception:
            return _error(identifier, -32603, "Internal bridge error; no evidence result is available")
    def handle(self, data):
        try:
            return self.dispatch(decode_frame(data))
        except WireError as error:
            return _error(None, error.code, str(error))
def encode_response(response):
    chunks, size = [], 0
    try:
        encoder = json.JSONEncoder(ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":"))
        for chunk in encoder.iterencode(response):
            encoded = chunk.encode("ascii")
            size += len(encoded)
            if size > MAX_OUTPUT_BYTES:
                raise WireError(-32002, "Output frame exceeds bridge byte limit; result withheld")
            chunks.append(encoded)
        return b"".join(chunks) + b"\n"
    except (ValueError, OverflowError, RecursionError) as error:
        code = error.code if isinstance(error, WireError) else -32603
        message = str(error) if isinstance(error, WireError) else "Result cannot be represented; evidence withheld"
        fallback = _error(response.get("id"), code, message)
        return json.dumps(fallback, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
def serve(source: BinaryIO, sink: BinaryIO) -> int:
    bridge = Bridge()
    try:
        while True:
            line = source.readline(MAX_FRAME_BYTES + 2)
            if not line:
                return 0
            if len(line) > MAX_FRAME_BYTES + 1 or (not line.endswith(b"\n") and len(line) > MAX_FRAME_BYTES):
                sink.write(encode_response(_error(None, -32002, "Input frame exceeds bridge byte limit; session closed")))
                sink.flush()
                return 2
            if not line.endswith(b"\n"):
                sink.write(encode_response(_error(None, -32700, "Final input frame lacks newline; session closed")))
                sink.flush()
                return 2
            response = bridge.handle(line[:-1])
            if response is not None:
                sink.write(encode_response(response))
                sink.flush()
    except (BrokenPipeError, OSError):
        return 2
def main() -> int:
    if len(sys.argv) != 1:
        sys.stderr.write("This bridge accepts no command-line options or paths; send bounded JSON-RPC on stdin.\n")
        return 2
    return serve(sys.stdin.buffer, sys.stdout.buffer)
if __name__ == "__main__":
    raise SystemExit(main())
