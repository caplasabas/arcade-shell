var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       * @param {Boolean} [isServer=false] Create the instance in either server or
       *     client mode
       * @param {Number} [maxPayload=0] The maximum allowed message length
       */
      constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http2 = require("http");
    var net2 = require("net");
    var tls = require("tls");
    var { randomBytes, createHash: createHash2 } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL } = require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL(address);
        } catch (e) {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http2.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(
          opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
          false,
          opts.maxPayload
        );
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash2("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net2.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net2.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http2 = require("http");
    var { Duplex } = require("stream");
    var { createHash: createHash2 } = require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http2.createServer((req, res) => {
            const body = http2.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server2 = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server2.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate(
            this.options.perMessageDeflate,
            true,
            this.options.maxPayload
          );
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash2("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
          const params = extensions[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server2, map) {
      for (const event of Object.keys(map)) server2.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server2.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server2) {
      server2._state = CLOSED;
      server2.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http2.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http2.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server2, req, socket, code, message, headers) {
      if (server2.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server2.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// apps/service/input.js
var import_http = __toESM(require("http"), 1);

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);

// apps/service/input.js
var import_child_process = require("child_process");
var import_crypto = require("crypto");
var import_dgram = __toESM(require("dgram"), 1);
var import_net = __toESM(require("net"), 1);
var import_os = __toESM(require("os"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var SERVICE_DIR = process.env.ARCADE_SERVICE_DIR || process.cwd();
var ARCADE_RUNTIME_DIR = process.env.ARCADE_RUNTIME_DIR || import_path.default.resolve(SERVICE_DIR, "..");
var ROMS_ROOT = process.env.ARCADE_ROMS_DIR || import_path.default.join(ARCADE_RUNTIME_DIR, "roms");
var DIST_DIR = process.env.ARCADE_UI_DIST_DIR || import_path.default.join(ARCADE_RUNTIME_DIR, "ui/dist");
var DEFAULT_RUNTIME_DIR = process.platform === "linux" ? "/dev/shm/arcade-games" : import_path.default.join(import_os.default.tmpdir(), "arcade-games");
var RUNTIME_GAMES_DIR = process.env.ARCADE_RUNTIME_GAMES_DIR || DEFAULT_RUNTIME_DIR;
var IS_LINUX = process.platform === "linux";
var FORCE_PI_MODE = process.env.ARCADE_FORCE_PI === "1";
var PI_MODEL_PATH = "/sys/firmware/devicetree/base/model";
var IS_PI = FORCE_PI_MODE || IS_LINUX && import_fs.default.existsSync(PI_MODEL_PATH) && (() => {
  try {
    return import_fs.default.readFileSync(PI_MODEL_PATH, "utf8").includes("Raspberry Pi");
  } catch {
    return false;
  }
})();
var GPIOCHIP = "gpiochip0";
var HOPPER_PAY_PIN = 17;
var HOPPER_TIMEOUT_MS = 6e4;
var HOPPER_NO_PULSE_TIMEOUT_MS = 3e3;
var INTERNET_PROBE_TIMEOUT_SEC = 2;
var INTERNET_MONITOR_INTERVAL_MS = 2e3;
var INTERNET_FAIL_THRESHOLD = 2;
var INTERNET_RESTORE_THRESHOLD = 2;
var JOYSTICK_BUTTON_MAP = {
  0: "SPIN",
  1: "BET_DOWN",
  2: "BET_UP",
  3: "AUTO",
  4: "COIN",
  // deposit coin pulses
  5: "WITHDRAW",
  // UI request
  6: "WITHDRAW_COIN",
  // hopper coin slot pulses
  7: "TURBO",
  8: "BUY",
  9: "MENU",
  10: "AUDIO",
  11: "HOPPER_COIN"
};
var RAW_BUTTON_MAP = {
  288: 0,
  289: 1,
  290: 2,
  291: 3,
  292: 4,
  293: 5,
  294: 6,
  295: 7,
  296: 8,
  297: 9,
  298: 10,
  299: 11
};
var HOPPER_TOPUP_COIN_VALUE = 20;
var COIN_IDLE_GAP_MS = 130;
var COIN_BATCH_GAP_MS = 180;
var shuttingDown = false;
var player1 = null;
var player2 = null;
var depositPulseCount = 0;
var depositIdleTimer = null;
var depositBatchCredits = 0;
var depositBatchTimer = null;
var depositLastPulseTime = 0;
var depositStartTime = 0;
var hopperActive = false;
var hopperTarget = 0;
var hopperDispensed = 0;
var hopperTimeout = null;
var hopperNoPulseTimeout = null;
var hopperLastPulseAt = 0;
var serverInstance = null;
var virtualP1 = null;
var virtualP2 = null;
var VIRTUAL_DEVICE_STAGGER_MS = 350;
var retroarchActive = false;
var retroarchProcess = null;
var retroarchStopping = false;
var lastExitTime = 0;
var retroarchStartedAt = 0;
var retroarchLogFd = null;
var retroarchStopTermTimer = null;
var retroarchStopForceTimer = null;
var pendingUiFallbackTimer = null;
var retroarchExitConfirmUntil = 0;
var retroarchCurrentGameId = null;
var lastExitedGameId = null;
var arcadeShellUpdateChild = null;
var arcadeShellUpdateTriggered = false;
var arcadeShellUpdateState = {
  status: "idle",
  phase: null,
  label: "",
  detail: null,
  startedAt: null,
  finishedAt: null,
  message: "",
  reason: null,
  exitCode: null
};
var GAME_VT = process.env.ARCADE_GAME_VT || "1";
var UI_VT = process.env.ARCADE_UI_VT || "2";
var RETROARCH_STOP_GRACE_MS = 3e3;
var RETROARCH_LOG_PATH = "/tmp/retroarch.log";
var RETROARCH_TERM_FALLBACK_MS = 1200;
var SINGLE_X_MODE = process.env.RETROARCH_SINGLE_X === "1";
var RETROARCH_USE_TTY_MODE = !SINGLE_X_MODE && process.env.RETROARCH_TTY_MODE === "1";
var RETROARCH_RUN_USER = process.env.RETROARCH_RUN_USER || "arcade1";
var RETROARCH_RUN_UID = String(process.env.RETROARCH_RUN_UID || "1000");
var RETROARCH_RUN_HOME = process.env.RETROARCH_RUN_HOME || `/home/${RETROARCH_RUN_USER}`;
var RETROARCH_RUNTIME_DIR = process.env.RETROARCH_XDG_RUNTIME_DIR || `/run/user/${RETROARCH_RUN_UID}`;
var RETROARCH_DBUS_ADDRESS = process.env.RETROARCH_DBUS_ADDRESS || `unix:path=${RETROARCH_RUNTIME_DIR}/bus`;
var RETROARCH_PULSE_SERVER = process.env.RETROARCH_PULSE_SERVER || `unix:${RETROARCH_RUNTIME_DIR}/pulse/native`;
var RETROARCH_USE_DBUS_RUN_SESSION = process.env.RETROARCH_USE_DBUS_RUN_SESSION === "1";
var RETROARCH_PRIMARY_INPUT = String(process.env.RETROARCH_PRIMARY_INPUT || "P1").toUpperCase();
var CASINO_MENU_EXITS_RETROARCH = process.env.CASINO_MENU_EXITS_RETROARCH !== "0";
var SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
var SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
console.log("[RETRO MODE]", {
  SINGLE_X_MODE,
  RETROARCH_USE_TTY_MODE,
  DISPLAY: process.env.DISPLAY || null,
  XAUTHORITY: process.env.XAUTHORITY || null
});
function parseNonNegativeMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
var RETROARCH_EXIT_GUARD_MS = parseNonNegativeMs(process.env.RETROARCH_EXIT_GUARD_MS, 1500);
var RETROARCH_EXIT_CONFIRM_WINDOW_MS = parseNonNegativeMs(
  process.env.RETROARCH_EXIT_CONFIRM_WINDOW_MS,
  2500
);
var RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS = parseNonNegativeMs(
  process.env.RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS,
  1500
);
var RETROARCH_CONFIG_PATH = process.env.RETROARCH_CONFIG_PATH || "";
var RESTART_UI_ON_EXIT = ["1", "true", "yes", "on"].includes(
  String(process.env.ARCADE_RESTART_UI_ON_GAME_EXIT || "").toLowerCase()
);
var UI_RESTART_COOLDOWN_MS = parseNonNegativeMs(process.env.ARCADE_UI_RESTART_COOLDOWN_MS, 4e3);
var LIBRETRO_DIR_CANDIDATES = [
  process.env.RETROARCH_CORE_DIR,
  "/usr/lib/aarch64-linux-gnu/libretro",
  "/usr/lib/arm-linux-gnueabihf/libretro",
  "/usr/lib/libretro"
].filter(Boolean);
var PS1_CORE_ALIASES = String(
  process.env.PS1_CORE_PRIORITY || "pcsx_rearmed,mednafen_psx,beetle_psx"
).split(",").map((v) => v.trim().toLowerCase().replace(/-/g, "_")).filter(Boolean);
var ARCADE_LIFE_PRICE_DEFAULT = (() => {
  const parsed = Number(process.env.ARCADE_LIFE_PRICE_DEFAULT || 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
})();
var ARCADE_LIFE_DEDUCT_MODE = String(process.env.ARCADE_LIFE_DEDUCT_MODE || "every_start").toLowerCase() === "unlock_once" ? "unlock_once" : "every_start";
var ARCADE_LIFE_DEDUCT_COOLDOWN_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_DEDUCT_COOLDOWN_MS,
  500
);
var ARCADE_LIFE_START_CONFIRM_WINDOW_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_START_CONFIRM_WINDOW_MS,
  2500
);
var ARCADE_LIFE_CREDIT_TTL_MS = parseNonNegativeMs(process.env.ARCADE_LIFE_CREDIT_TTL_MS, 3e5);
var ARCADE_LIFE_FAIL_OPEN = process.env.ARCADE_LIFE_FAIL_OPEN === "1";
var ARCADE_RETRO_OSD_ENABLED = process.env.ARCADE_RETRO_OSD !== "0";
var RETROARCH_NETCMD_HOST = process.env.RETROARCH_NETCMD_HOST || "127.0.0.1";
var RETROARCH_NETCMD_PORT = Number(process.env.RETROARCH_NETCMD_PORT || 55355);
var RETROARCH_OSD_COMMAND = String(process.env.RETROARCH_OSD_COMMAND || "AUTO").trim().toUpperCase();
var ARCADE_RETRO_OSD_COOLDOWN_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_COOLDOWN_MS,
  250
);
var ARCADE_RETRO_OSD_RETRY_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_RETRY_INTERVAL_MS,
  180
);
var ARCADE_RETRO_OSD_RETRY_COUNT = (() => {
  const parsed = Number(process.env.ARCADE_RETRO_OSD_RETRY_COUNT || 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(8, Math.round(parsed)));
})();
var ARCADE_RETRO_OSD_PROMPT_PERSIST = process.env.ARCADE_RETRO_OSD_PROMPT_PERSIST !== "0";
var ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS,
  400
);
var ARCADE_RETRO_OSD_PROMPT_BLINK = process.env.ARCADE_RETRO_OSD_PROMPT_BLINK === "1";
var ARCADE_RETRO_OSD_STYLE = (() => {
  const style = String(process.env.ARCADE_RETRO_OSD_STYLE || "footer").toLowerCase().trim();
  if (style === "hud" || style === "legacy" || style === "footer") return style;
  return "footer";
})();
var ARCADE_RETRO_OSD_LABEL = String(process.env.ARCADE_RETRO_OSD_LABEL || "").replace(/\s+/g, " ").trim();
var ARCADE_RETRO_OSD_SHOW_SESSION_STATS = process.env.ARCADE_RETRO_OSD_SHOW_SESSION_STATS !== "0";
var ARCADE_LIFE_CONTINUE_SECONDS = (() => {
  const parsed = Number(process.env.ARCADE_LIFE_CONTINUE_SECONDS || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(30, Math.round(parsed)));
})();
var ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS = parseNonNegativeMs(
  process.env.ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS,
  1e3
);
var ARCADE_LIFE_PURCHASE_BUTTON_INDEXES = (() => {
  const raw = String(process.env.ARCADE_LIFE_PURCHASE_BUTTON_INDEXES || "8");
  const parsed = raw.split(",").map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v >= 0 && v <= 31);
  if (parsed.length > 0) return new Set(parsed);
  return /* @__PURE__ */ new Set([8]);
})();
var ARCADE_LIFE_PURCHASE_LABEL = String(process.env.ARCADE_LIFE_PURCHASE_LABEL || "Buy").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 16) || "Buy";
var START_BUTTON_INDEXES = /* @__PURE__ */ new Set([7, 9]);
var lastUiVT = UI_VT;
var lastUiRestartAt = 0;
var chromiumUiHidden = false;
function getXClientEnv() {
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ":0",
    XAUTHORITY: process.env.XAUTHORITY || `${RETROARCH_RUN_HOME}/.Xauthority`,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || RETROARCH_RUNTIME_DIR
  };
}
function runXClientCommand(command, args, label) {
  try {
    const proc = (0, import_child_process.spawn)(command, args, {
      env: getXClientEnv(),
      detached: true,
      stdio: "ignore"
    });
    proc.on("error", (err) => {
      console.warn(`[UI] ${label} failed: ${err.message}`);
    });
    proc.unref();
    return true;
  } catch (err) {
    console.warn(`[UI] ${label} failed: ${err.message}`);
    return false;
  }
}
function hasCommand(name) {
  const result = (0, import_child_process.spawnSync)("sh", ["-lc", `command -v ${name} >/dev/null 2>&1`], {
    stdio: "ignore"
  });
  return result.status === 0;
}
function hideChromiumUiForRetroarch() {
  if (!SINGLE_X_MODE) return;
  if (chromiumUiHidden) return;
  let attempted = false;
  if (hasCommand("xdotool")) {
    attempted = true;
    runXClientCommand(
      "sh",
      [
        "-lc",
        "xdotool search --onlyvisible --class chromium windowunmap %@ >/dev/null 2>&1 || true"
      ],
      "xdotool minimize chromium"
    );
  }
  if (hasCommand("wmctrl")) {
    attempted = true;
    runXClientCommand(
      "sh",
      ["-lc", "wmctrl -x -r chromium.Chromium -b add,hidden >/dev/null 2>&1 || true"],
      "wmctrl hide chromium"
    );
  }
  if (attempted) {
    chromiumUiHidden = true;
    console.log("[UI] Chromium hide requested before RetroArch launch");
  } else {
    console.log("[UI] Chromium hide skipped (xdotool/wmctrl not installed)");
  }
}
function restoreChromiumUiAfterRetroarch() {
  if (!SINGLE_X_MODE) return;
  if (!chromiumUiHidden) return;
  let attempted = false;
  if (hasCommand("xdotool")) {
    attempted = true;
    runXClientCommand(
      "sh",
      [
        "-lc",
        "xdotool search --class chromium windowmap %@ windowraise %@ >/dev/null 2>&1 || true"
      ],
      "xdotool restore chromium"
    );
  }
  if (hasCommand("wmctrl")) {
    attempted = true;
    runXClientCommand(
      "sh",
      [
        "-lc",
        "wmctrl -x -r chromium.Chromium -b remove,hidden >/dev/null 2>&1 || true; wmctrl -x -a chromium.Chromium >/dev/null 2>&1 || true"
      ],
      "wmctrl restore chromium"
    );
  }
  chromiumUiHidden = false;
  if (attempted) {
    console.log("[UI] Chromium restore requested after RetroArch exit");
  }
}
var arcadeSession = null;
var lastArcadeOsdMessage = "";
var lastArcadeOsdAt = 0;
var arcadeContinueCountdownTimers = { P1: null, P2: null };
var arcadeCreditExpiryTimers = { P1: null, P2: null };
var arcadePromptLoopTimer = null;
var arcadePromptBlinkPhase = false;
var lastArcadePromptLoopMessage = "";
var lastArcadePromptLoopSentAt = 0;
var arcadeBalanceSyncTimer = null;
var arcadeBalanceSyncInFlight = false;
function getActiveVT() {
  if (!RETROARCH_USE_TTY_MODE) return null;
  if (!IS_PI) return null;
  const result = (0, import_child_process.spawnSync)("fgconsole", [], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = String(result.stdout || "").trim();
  return value || null;
}
function getTargetUiVT() {
  return lastUiVT || UI_VT;
}
console.log(`
ARCADE INPUT SERVICE
--------------------
USB Encoder : /dev/input/casino
GPIO Chip   : ${GPIOCHIP}
Runtime Mode: ${IS_PI ? "Raspberry Pi (hardware)" : `compat (${process.platform})`}
Display Mode : ${SINGLE_X_MODE ? "single-x(:0)" : `tty ui=${UI_VT} game=${GAME_VT}`}
Retro P1 In : ${RETROARCH_PRIMARY_INPUT}
Casino Exit : ${CASINO_MENU_EXITS_RETROARCH ? "enabled" : "disabled"}
Exit Guard  : ${RETROARCH_EXIT_GUARD_MS}ms
Exit Confirm: ${RETROARCH_EXIT_CONFIRM_WINDOW_MS}ms
Exit Cooldown: ${RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS}ms
RA Config   : ${RETROARCH_CONFIG_PATH || "(default)"}
RA OSD Cmd  : ${ARCADE_RETRO_OSD_ENABLED ? RETROARCH_OSD_COMMAND : "disabled"} (${ARCADE_RETRO_OSD_COOLDOWN_MS}ms)
RA OSD Retry: ${ARCADE_RETRO_OSD_RETRY_COUNT}x/${ARCADE_RETRO_OSD_RETRY_INTERVAL_MS}ms
RA OSD Prompt: ${ARCADE_RETRO_OSD_PROMPT_PERSIST ? `on/${ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS}ms` : "off"} (${ARCADE_RETRO_OSD_PROMPT_BLINK ? "blink" : "steady"})
RA OSD Style: ${ARCADE_RETRO_OSD_STYLE}${ARCADE_RETRO_OSD_STYLE === "hud" ? ` (${ARCADE_RETRO_OSD_LABEL || "HUD"})` : ""}
Continue OSD: ${ARCADE_LIFE_CONTINUE_SECONDS > 0 ? `${ARCADE_LIFE_CONTINUE_SECONDS}s` : "disabled"}
Life Buy Btn : ${[...ARCADE_LIFE_PURCHASE_BUTTON_INDEXES].join(",")} (${ARCADE_LIFE_PURCHASE_LABEL})
Life Bal Sync: ${hasSupabaseRpcConfig() ? `on/${ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS}ms` : "off"}
UI Restart  : ${RESTART_UI_ON_EXIT ? "enabled" : "disabled"} (${UI_RESTART_COOLDOWN_MS}ms)
Arcade Life : mode=${ARCADE_LIFE_DEDUCT_MODE} default=\u20B1${ARCADE_LIFE_PRICE_DEFAULT} failOpen=${ARCADE_LIFE_FAIL_OPEN ? "yes" : "no"}
Start Confirm: ${ARCADE_LIFE_START_CONFIRM_WINDOW_MS}ms
Supabase RPC: ${SUPABASE_URL ? "configured" : "missing"} / key=${SUPABASE_SERVICE_KEY ? "set" : "missing"}

Ctrl+C to exit
`);
var wss = new import_websocket_server.default({ port: 5175 });
wss.on("error", (err) => {
  console.error("[WS SERVER ERROR]", err);
});
wss.on("listening", () => {
  console.log("[WS] listening on port 5175");
});
wss.on("connection", async (ws) => {
  console.log("[WS] client connected");
  const online = await checkInternetOnce();
  ws.send(
    JSON.stringify({
      type: online ? "INTERNET_OK" : "INTERNET_LOST"
    })
  );
  ws.on("close", () => {
    console.log("[WS] client disconnected");
  });
  ws.on("error", (err) => {
    console.error("[WS CLIENT ERROR]", err.message);
  });
});
function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(data);
      } catch (err) {
        console.error("[WS SEND ERROR]", err.message);
      }
    }
  }
}
async function dispatch(payload) {
  if (shuttingDown) return;
  try {
    console.log("[SEND]", payload);
    broadcast(payload);
  } catch (err) {
    console.error("[DISPATCH ERROR]", err.message);
  }
}
function hasSupabaseRpcConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}
function getSupabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json"
  };
}
function toMoney(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed * 100) / 100);
}
function formatPeso(amount, withSymbol = false, withDecimal = true, decimalCount = 2, abbreviate = false) {
  const num = Number(amount);
  if (isNaN(num)) return withSymbol ? "$0" : "0";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  let value;
  if (abbreviate) {
    if (abs >= 1e9) {
      const v = Math.floor(abs / 1e9 * 100) / 100;
      value = v.toString().replace(/\.00$/, "") + "B";
    } else if (abs >= 1e6) {
      const v = Math.floor(abs / 1e6 * 100) / 100;
      value = v.toString().replace(/\.00$/, "") + "M";
    } else if (abs >= 1e4) {
      const v = Math.floor(abs / 1e3 * 100) / 100;
      value = v.toString().replace(/\.00$/, "") + "K";
    } else {
      value = abs.toLocaleString();
    }
  } else {
    value = abs.toFixed(withDecimal ? decimalCount : 2).replace(/\d(?=(\d{3})+\.)/g, "$&,");
    if (withDecimal && decimalCount > 2 && value.endsWith(".00")) {
      value = value.slice(0, -3);
    }
  }
  return `${sign}${withSymbol ? "$" : ""}${value}`;
}
function isStartButton(index) {
  return START_BUTTON_INDEXES.has(index);
}
function isLifePurchaseButton(index) {
  return ARCADE_LIFE_PURCHASE_BUTTON_INDEXES.has(index);
}
function getArcadeLifePromptActionLabel() {
  if (ARCADE_LIFE_PURCHASE_LABEL === "START") return "START";
  return `START OR ${ARCADE_LIFE_PURCHASE_LABEL}`;
}
function normalizeArcadePlayer(source) {
  const mapped = resolveRetroInputSource(source);
  if (mapped === "P1" || mapped === "P2") return mapped;
  return null;
}
function sendRetroarchNetCommand(command) {
  if (!ARCADE_RETRO_OSD_ENABLED) return;
  if (!retroarchActive) return;
  if (!Number.isFinite(RETROARCH_NETCMD_PORT) || RETROARCH_NETCMD_PORT <= 0) return;
  const clean = String(command || "").trim();
  const message = `${clean}
`;
  if (!message.trim()) return;
  const sendOnce = (attempt) => {
    const udpSocket = import_dgram.default.createSocket("udp4");
    const udpPayload = Buffer.from(message, "utf8");
    udpSocket.send(udpPayload, RETROARCH_NETCMD_PORT, RETROARCH_NETCMD_HOST, (err) => {
      if (err) {
        console.error("[RETROARCH OSD] UDP send failed", err.message);
      }
      udpSocket.close();
    });
    const tcpSocket = import_net.default.createConnection(
      {
        host: RETROARCH_NETCMD_HOST,
        port: RETROARCH_NETCMD_PORT
      },
      () => {
        tcpSocket.write(message, () => tcpSocket.end());
      }
    );
    tcpSocket.setTimeout(300);
    tcpSocket.on("error", () => {
    });
    tcpSocket.on("timeout", () => {
      tcpSocket.destroy();
    });
    console.log(`[RETROARCH OSD] #${attempt}/${ARCADE_RETRO_OSD_RETRY_COUNT} ${clean}`);
  };
  for (let attempt = 1; attempt <= ARCADE_RETRO_OSD_RETRY_COUNT; attempt += 1) {
    const delay = (attempt - 1) * ARCADE_RETRO_OSD_RETRY_INTERVAL_MS;
    if (delay <= 0) {
      sendOnce(attempt);
      continue;
    }
    setTimeout(() => {
      if (!retroarchActive) return;
      sendOnce(attempt);
    }, delay);
  }
}
function showArcadeOsdMessage(message, options = {}) {
  if (RETROARCH_OSD_COMMAND === "OFF" || RETROARCH_OSD_COMMAND === "NONE") return;
  const allowBlank = options?.allowBlank === true;
  const bypassCooldown = options?.bypassCooldown === true;
  const source = String(message || "").replace(/[\r\n\t]/g, " ");
  const normalized = ARCADE_RETRO_OSD_STYLE === "footer" ? source.slice(0, 180) : source.replace(/\s+/g, " ").slice(0, 120);
  const text = allowBlank ? normalized : normalized.trim();
  if (!text && !allowBlank) return;
  const messageKey = text || "__BLANK__";
  const now = Date.now();
  if (!bypassCooldown && messageKey === lastArcadeOsdMessage) {
    if (now - lastArcadeOsdAt < ARCADE_RETRO_OSD_COOLDOWN_MS) return;
  }
  lastArcadeOsdMessage = messageKey;
  lastArcadeOsdAt = now;
  const osdCommands = (() => {
    if (RETROARCH_OSD_COMMAND === "AUTO") return ["SHOW_MSG", "SHOW_MESG"];
    if (RETROARCH_OSD_COMMAND === "SHOW_MSG") return ["SHOW_MSG"];
    if (RETROARCH_OSD_COMMAND === "SHOW_MESG") return ["SHOW_MESG"];
    return [RETROARCH_OSD_COMMAND];
  })();
  const seen = /* @__PURE__ */ new Set();
  for (const osdCommand of osdCommands) {
    if (seen.has(osdCommand)) continue;
    seen.add(osdCommand);
    const command = text ? `${osdCommand} ${text}` : osdCommand;
    sendRetroarchNetCommand(command);
  }
}
function formatArcadeBalanceForOsd(rawBalance) {
  if (rawBalance === null || rawBalance === void 0) return "0.00";
  return formatPeso(toMoney(rawBalance, 0));
}
function isArcadePlayerLocked(source) {
  if (!retroarchActive || !arcadeSession?.active) return false;
  const player = normalizeArcadePlayer(source);
  if (!player) return false;
  return !playerHasStoredCredit(player);
}
function isAllowedLockedInput(index) {
  return isStartButton(index) || isLifePurchaseButton(index);
}
function isBlockedCasinoActionDuringRetroarch(action) {
  return action === "WITHDRAW" || action === "WITHDRAW_COIN" || action === "HOPPER_COIN";
}
function composeArcadeOsdOverlay(message, balanceOverride = null, options = null) {
  const base = String(message || "").replace(/\s+/g, " ").trim();
  if (!arcadeSession?.active) return base;
  const p1Lives = Number(arcadeSession.playerLivesPurchased?.P1 || 0);
  const p2Lives = Number(arcadeSession.playerLivesPurchased?.P2 || 0);
  const rawBalance = balanceOverride === null || balanceOverride === void 0 ? arcadeSession.lastKnownBalance : balanceOverride;
  const balanceText = formatArcadeBalanceForOsd(rawBalance);
  const balanceBanner = `Balance \u20B1${balanceText}`;
  if (ARCADE_RETRO_OSD_STYLE === "footer") {
    const now = Date.now();
    const p1Ready = Boolean(arcadeSession.playerUnlocked?.P1);
    const p2Ready = Boolean(arcadeSession.playerUnlocked?.P2);
    const p1ConfirmArmed = Number(arcadeSession.startConfirmUntil?.P1 || 0) > now;
    const p2ConfirmArmed = Number(arcadeSession.startConfirmUntil?.P2 || 0) > now;
    const exitConfirmArmed = Number(retroarchExitConfirmUntil || 0) > now;
    const p1HasCredit = Number(arcadeSession.playerLivesPurchased?.P1 || 0) > 0;
    const p2HasCredit = Number(arcadeSession.playerLivesPurchased?.P2 || 0) > 0;
    const leftBase = p1HasCredit ? "CREDITS 1" : p1ConfirmArmed ? "START GAME?" : "PRESS [START]";
    const centerBase = exitConfirmArmed ? "EXIT GAME?" : `Balance \u20B1${balanceText}`;
    const rightBase = p2HasCredit ? "CREDITS 1" : p2ConfirmArmed ? "START GAME?" : "PRESS [START]";
    const leftText = arcadeOverlayNotice?.slot === "left" ? arcadeOverlayNotice.text : leftBase;
    const centerText = arcadeOverlayNotice?.slot === "center" ? arcadeOverlayNotice.text : centerBase;
    const rightText = arcadeOverlayNotice?.slot === "right" ? arcadeOverlayNotice.text : rightBase;
    const centerIn = (txt, w) => {
      const clean = String(txt || "");
      if (clean.length >= w) return clean.slice(0, w);
      const leftPad = Math.floor((w - clean.length) / 2);
      const rightPad = w - clean.length - leftPad;
      return `${" ".repeat(leftPad)}${clean}${" ".repeat(rightPad)}`;
    };
    const colW = 20;
    const gap = "       ";
    const leftCol = centerIn(leftText, colW);
    const centerCol = centerIn(centerText, colW);
    const rightCol = centerIn(rightText, colW);
    return `${leftCol}${gap}${centerCol}${gap}${rightCol}`;
  }
  if (ARCADE_RETRO_OSD_STYLE === "hud") {
    const hudParts = [];
    if (ARCADE_RETRO_OSD_LABEL) hudParts.push(ARCADE_RETRO_OSD_LABEL);
    hudParts.push(balanceBanner);
    hudParts.push(arcadeOverlayNotice || base);
    if (ARCADE_RETRO_OSD_SHOW_SESSION_STATS) {
      hudParts.push(`P1:${p1Lives}`, `P2:${p2Lives}`, `Balance:P${balanceText}`);
    }
    const continueSeconds = Number(options?.continueSeconds);
    if (Number.isFinite(continueSeconds) && continueSeconds >= 0) {
      hudParts.push(`CONTINUE:${String(Math.round(continueSeconds)).padStart(2, "0")}`);
    }
    return hudParts.join(" | ");
  }
  return `${arcadeOverlayNotice || base} | P1:${p1Lives} P2:${p2Lives} Balance:P${balanceText}`;
}
function pulseVirtualKey(proc, keyCode, holdMs = 45) {
  sendVirtual(proc, EV_KEY, keyCode, 1);
  setTimeout(
    () => {
      sendVirtual(proc, EV_KEY, keyCode, 0);
    },
    Math.max(10, holdMs)
  );
}
function getArcadeSessionPrice() {
  if (!arcadeSession?.active) return ARCADE_LIFE_PRICE_DEFAULT;
  return toMoney(arcadeSession.pricePerLife, ARCADE_LIFE_PRICE_DEFAULT);
}
function clearArcadeContinueCountdown(player = null) {
  const players = player && arcadeContinueCountdownTimers[player] !== void 0 ? [player] : Object.keys(arcadeContinueCountdownTimers);
  for (const currentPlayer of players) {
    const timer = arcadeContinueCountdownTimers[currentPlayer];
    if (!timer) continue;
    clearTimeout(timer);
    arcadeContinueCountdownTimers[currentPlayer] = null;
  }
}
function releaseAllVirtualInputsForPlayer(player) {
  const target = player === "P1" ? virtualP1 : player === "P2" ? virtualP2 : null;
  if (!target) return;
  sendVirtual(target, EV_KEY, BTN_SOUTH, 0);
  sendVirtual(target, EV_KEY, BTN_EAST, 0);
  sendVirtual(target, EV_KEY, BTN_NORTH, 0);
  sendVirtual(target, EV_KEY, BTN_WEST, 0);
  sendVirtual(target, EV_KEY, BTN_TL, 0);
  sendVirtual(target, EV_KEY, BTN_TR, 0);
  sendVirtual(target, EV_KEY, BTN_SELECT, 0);
  sendVirtual(target, EV_KEY, BTN_START, 0);
  sendVirtual(target, EV_KEY, BTN_DPAD_UP, 0);
  sendVirtual(target, EV_KEY, BTN_DPAD_DOWN, 0);
  sendVirtual(target, EV_KEY, BTN_DPAD_LEFT, 0);
  sendVirtual(target, EV_KEY, BTN_DPAD_RIGHT, 0);
  dpadState[player] = { up: false, down: false, left: false, right: false };
}
function clearArcadeCreditExpiry(player = null) {
  const players = player && arcadeCreditExpiryTimers[player] !== void 0 ? [player] : Object.keys(arcadeCreditExpiryTimers);
  for (const currentPlayer of players) {
    const timer = arcadeCreditExpiryTimers[currentPlayer];
    if (!timer) continue;
    clearTimeout(timer);
    arcadeCreditExpiryTimers[currentPlayer] = null;
  }
}
function playerHasStoredCredit(player) {
  if (!arcadeSession?.active) return false;
  if (player !== "P1" && player !== "P2") return false;
  return Number(arcadeSession.playerLivesPurchased?.[player] || 0) > 0;
}
function clearArcadePromptLoop() {
  if (arcadePromptLoopTimer !== null) {
    clearTimeout(arcadePromptLoopTimer);
    arcadePromptLoopTimer = null;
  }
  arcadePromptBlinkPhase = false;
  lastArcadePromptLoopMessage = "";
  lastArcadePromptLoopSentAt = 0;
}
function buildArcadePromptMessage() {
  if (!arcadeSession?.active) return "";
  const p1HasCredit = playerHasStoredCredit("P1");
  const p2HasCredit = playerHasStoredCredit("P2");
  const waitingP1 = !p1HasCredit && !arcadeContinueCountdownTimers.P1;
  const waitingP2 = !p2HasCredit && !arcadeContinueCountdownTimers.P2;
  if (waitingP1 || waitingP2) {
    const priceText = getArcadeSessionPrice().toFixed(2);
    const actionLabel = getArcadeLifePromptActionLabel();
    if (waitingP1 && waitingP2) {
      return composeArcadeOsdOverlay(`PRESS ${actionLabel} TO PLAY (P${priceText}/CREDIT)`);
    }
    if (waitingP1) {
      return composeArcadeOsdOverlay(`P1 PRESS ${actionLabel} (P${priceText})`);
    }
    return composeArcadeOsdOverlay(`P2 PRESS ${actionLabel} (P${priceText})`);
  }
  if (!p1HasCredit || !p2HasCredit) {
    const priceText = getArcadeSessionPrice().toFixed(2);
    const actionLabel = getArcadeLifePromptActionLabel();
    if (!p1HasCredit && !p2HasCredit) {
      return composeArcadeOsdOverlay(`LOCKED | PRESS ${actionLabel} (P${priceText}/CREDIT)`);
    }
    if (!p1HasCredit) {
      return composeArcadeOsdOverlay(`P1 LOCKED | PRESS ${actionLabel} (P${priceText})`);
    }
    return composeArcadeOsdOverlay(`P2 LOCKED | PRESS ${actionLabel} (P${priceText})`);
  }
  return composeArcadeOsdOverlay("P1 READY | P2 READY");
}
function scheduleArcadePromptLoop() {
  clearArcadePromptLoop();
  if (!ARCADE_RETRO_OSD_PROMPT_PERSIST) return;
  const HEARTBEAT_MS = 2200;
  const tick = () => {
    if (!arcadeSession?.active) {
      clearArcadePromptLoop();
      return;
    }
    const promptMessage = buildArcadePromptMessage();
    if (promptMessage) {
      if (ARCADE_RETRO_OSD_PROMPT_BLINK) {
        arcadePromptBlinkPhase = !arcadePromptBlinkPhase;
        if (arcadePromptBlinkPhase) {
          showArcadeOsdMessage(promptMessage, { bypassCooldown: true });
        } else {
          showArcadeOsdMessage("", { allowBlank: true, bypassCooldown: true });
        }
      } else {
        const now = Date.now();
        const changed = promptMessage !== lastArcadePromptLoopMessage;
        const heartbeatDue = now - lastArcadePromptLoopSentAt >= HEARTBEAT_MS;
        if (changed || heartbeatDue) {
          showArcadeOsdMessage(promptMessage, { bypassCooldown: changed });
          lastArcadePromptLoopMessage = promptMessage;
          lastArcadePromptLoopSentAt = now;
        }
      }
    } else {
      arcadePromptBlinkPhase = false;
      lastArcadePromptLoopMessage = "";
      lastArcadePromptLoopSentAt = 0;
    }
    arcadePromptLoopTimer = setTimeout(tick, ARCADE_RETRO_OSD_PROMPT_INTERVAL_MS);
  };
  tick();
}
function startArcadeContinueCountdown(player) {
  if (!arcadeSession?.active) return;
  if (ARCADE_LIFE_CONTINUE_SECONDS <= 0) return;
  if (player !== "P1" && player !== "P2") return;
  clearArcadeContinueCountdown(player);
  let remaining = ARCADE_LIFE_CONTINUE_SECONDS;
  const playerIndex = player.slice(1);
  const tick = () => {
    if (!arcadeSession?.active) {
      clearArcadeContinueCountdown(player);
      return;
    }
    if (playerHasStoredCredit(player)) {
      clearArcadeContinueCountdown(player);
      return;
    }
    const priceText = getArcadeSessionPrice().toFixed(2);
    const actionLabel = getArcadeLifePromptActionLabel();
    showArcadeOsdMessage(
      composeArcadeOsdOverlay(`P${playerIndex} PRESS ${actionLabel} (P${priceText})`, null, {
        continueSeconds: remaining
      })
    );
    if (remaining <= 0) {
      clearArcadeContinueCountdown(player);
      return;
    }
    remaining -= 1;
    arcadeContinueCountdownTimers[player] = setTimeout(tick, 1e3);
  };
  tick();
}
function broadcastArcadeLifeState(status = "state", extra = {}) {
  if (!arcadeSession?.active) {
    dispatch({
      type: "ARCADE_LIFE_STATE",
      active: false,
      status,
      ...extra
    });
    return;
  }
  dispatch({
    type: "ARCADE_LIFE_STATE",
    active: true,
    status,
    gameId: arcadeSession.gameId,
    gameName: arcadeSession.gameName,
    pricePerLife: arcadeSession.pricePerLife,
    p1Unlocked: playerHasStoredCredit("P1"),
    p2Unlocked: playerHasStoredCredit("P2"),
    p1LivesPurchased: Number(arcadeSession.playerLivesPurchased?.P1 || 0),
    p2LivesPurchased: Number(arcadeSession.playerLivesPurchased?.P2 || 0),
    balance: arcadeSession.lastKnownBalance,
    ...extra
  });
}
async function fetchDeviceBalanceSnapshot() {
  if (!hasSupabaseRpcConfig()) return null;
  const url = `${SUPABASE_URL}/rest/v1/devices?select=balance&device_id=eq.${encodeURIComponent(DEVICE_ID)}&limit=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: getSupabaseHeaders(),
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) {
    throw new Error(`balance fetch failed (${response.status})`);
  }
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.balance === null || row.balance === void 0) return null;
  return toMoney(row.balance, 0);
}
function clearArcadeBalanceSyncLoop() {
  if (arcadeBalanceSyncTimer !== null) {
    clearTimeout(arcadeBalanceSyncTimer);
    arcadeBalanceSyncTimer = null;
  }
}
async function syncArcadeSessionBalance(options = {}) {
  if (!arcadeSession?.active) return;
  if (!hasSupabaseRpcConfig()) return;
  if (arcadeBalanceSyncInFlight) return;
  const forceBroadcast = options?.forceBroadcast === true;
  arcadeBalanceSyncInFlight = true;
  try {
    const latestBalance = await fetchDeviceBalanceSnapshot();
    if (!arcadeSession?.active) return;
    if (latestBalance === null || latestBalance === void 0) return;
    const previous = arcadeSession.lastKnownBalance;
    arcadeSession.lastKnownBalance = latestBalance;
    if (previous !== latestBalance) {
      console.log("[ARCADE LIFE BALANCE] applied", { previous, next: latestBalance });
      broadcastArcadeLifeState("balance_sync", { balance: latestBalance });
      showArcadeOsdMessage(composeArcadeOsdOverlay(""), { bypassCooldown: true });
    }
  } catch {
  } finally {
    arcadeBalanceSyncInFlight = false;
  }
}
function scheduleArcadeBalanceSyncLoop() {
  clearArcadeBalanceSyncLoop();
  if (!hasSupabaseRpcConfig()) return;
  const tick = async () => {
    if (!arcadeSession?.active) {
      clearArcadeBalanceSyncLoop();
      return;
    }
    await syncArcadeSessionBalance();
    arcadeBalanceSyncTimer = setTimeout(tick, ARCADE_LIFE_BALANCE_SYNC_INTERVAL_MS);
  };
  tick();
}
function startArcadeLifeSession({ gameId, gameName, pricePerLife, initialBalance = null }) {
  clearArcadeBalanceSyncLoop();
  clearArcadePromptLoop();
  clearArcadeContinueCountdown();
  clearArcadeCreditExpiry();
  clearArcadeOverlayNotice();
  arcadeSession = {
    active: true,
    gameId: String(gameId || "").trim() || "unknown",
    gameName: String(gameName || "").trim() || String(gameId || "").trim() || "Arcade Game",
    pricePerLife: toMoney(pricePerLife, ARCADE_LIFE_PRICE_DEFAULT),
    playerUnlocked: { P1: false, P2: false },
    playerLivesPurchased: { P1: 0, P2: 0 },
    purchaseInFlight: { P1: false, P2: false },
    startConfirmUntil: { P1: 0, P2: 0 },
    lastChargeAt: { P1: 0, P2: 0 },
    lastKnownBalance: initialBalance === null || initialBalance === void 0 ? null : toMoney(initialBalance, 0)
  };
  const priceText = getArcadeSessionPrice().toFixed(2);
  const actionLabel = getArcadeLifePromptActionLabel();
  showArcadeOsdMessage(
    composeArcadeOsdOverlay(`PRESS ${actionLabel} TO PLAY (P${priceText}/CREDIT)`)
  );
  broadcastArcadeLifeState("started");
  const sessionRef = arcadeSession;
  setTimeout(() => {
    if (!arcadeSession?.active || arcadeSession !== sessionRef) return;
    if (playerHasStoredCredit("P1") || playerHasStoredCredit("P2")) return;
    const promptPriceText = getArcadeSessionPrice().toFixed(2);
    const promptActionLabel = getArcadeLifePromptActionLabel();
    showArcadeOsdMessage(
      composeArcadeOsdOverlay(`PRESS ${promptActionLabel} TO PLAY (P${promptPriceText}/CREDIT)`)
    );
  }, 2e3);
  scheduleArcadePromptLoop();
  scheduleArcadeBalanceSyncLoop();
  syncArcadeSessionBalance({ forceBroadcast: true });
}
function clearArcadeLifeSession(reason = "ended") {
  if (!arcadeSession?.active) return;
  const endedSession = arcadeSession;
  arcadeSession = null;
  clearArcadeBalanceSyncLoop();
  clearArcadePromptLoop();
  clearArcadeContinueCountdown();
  clearArcadeCreditExpiry();
  clearArcadeOverlayNotice();
  dispatch({
    type: "ARCADE_LIFE_SESSION_ENDED",
    status: reason,
    gameId: endedSession.gameId,
    gameName: endedSession.gameName,
    p1LivesPurchased: Number(endedSession.playerLivesPurchased?.P1 || 0),
    p2LivesPurchased: Number(endedSession.playerLivesPurchased?.P2 || 0),
    balance: endedSession.lastKnownBalance
  });
}
async function fetchGameProfileForArcadeLife(gameId) {
  if (!hasSupabaseRpcConfig()) return null;
  const safeId = String(gameId || "").trim();
  if (!safeId) return null;
  const url = `${SUPABASE_URL}/rest/v1/games?select=id,name,price,type,enabled&id=eq.${encodeURIComponent(safeId)}&type=eq.arcade&limit=1`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: getSupabaseHeaders(),
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[ARCADE LIFE] game profile fetch failed", response.status, text);
      return null;
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.enabled === false) return null;
    return {
      gameId: row.id || safeId,
      gameName: row.name || safeId,
      pricePerLife: toMoney(row.price, ARCADE_LIFE_PRICE_DEFAULT)
    };
  } catch (err) {
    console.error("[ARCADE LIFE] game profile fetch error", err?.message || err);
    return null;
  }
}
async function consumeArcadeLifeCharge({ player, reason = "start" }) {
  const pricePerLife = getArcadeSessionPrice();
  const gameId = arcadeSession?.gameId || "unknown";
  if (!hasSupabaseRpcConfig()) {
    if (ARCADE_LIFE_FAIL_OPEN) {
      return {
        ok: true,
        balance: arcadeSession?.lastKnownBalance ?? null,
        chargedAmount: pricePerLife,
        reason: "fail_open_backend_missing"
      };
    }
    return {
      ok: false,
      balance: arcadeSession?.lastKnownBalance ?? null,
      chargedAmount: 0,
      reason: "payment_backend_missing"
    };
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_arcade_life`, {
      method: "POST",
      headers: getSupabaseHeaders(),
      signal: AbortSignal.timeout(3500),
      body: JSON.stringify({
        p_device_id: DEVICE_ID,
        p_game_id: gameId,
        p_player: player,
        p_amount: pricePerLife,
        p_reason: reason,
        p_event_ts: (/* @__PURE__ */ new Date()).toISOString(),
        p_metadata: {
          source: "arcade-input-service",
          mode: ARCADE_LIFE_DEDUCT_MODE
        }
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[ARCADE LIFE] rpc failed", response.status, text);
      if (ARCADE_LIFE_FAIL_OPEN) {
        return {
          ok: true,
          balance: arcadeSession?.lastKnownBalance ?? null,
          chargedAmount: pricePerLife,
          reason: "fail_open_rpc_error"
        };
      }
      return {
        ok: false,
        balance: arcadeSession?.lastKnownBalance ?? null,
        chargedAmount: 0,
        reason: "payment_rpc_error"
      };
    }
    const body = await response.json();
    const row = Array.isArray(body) ? body[0] : body;
    const rowReason = String(row?.reason || "").toLowerCase().trim();
    const chargedAmountRaw = toMoney(row?.charged_amount, 0);
    const ok = row?.ok === true || row?.ok === 1 || row?.ok === "1" || row?.ok === "t" || row?.ok === "true" || rowReason === "charged" || chargedAmountRaw > 0;
    const nextBalance = row?.balance === null || row?.balance === void 0 ? arcadeSession?.lastKnownBalance ?? null : toMoney(row.balance, 0);
    return {
      ok,
      balance: nextBalance,
      chargedAmount: chargedAmountRaw > 0 ? chargedAmountRaw : ok ? pricePerLife : 0,
      reason: String(row?.reason || (ok ? "charged" : "insufficient_balance"))
    };
  } catch (err) {
    console.error("[ARCADE LIFE] rpc error", err?.message || err);
    if (ARCADE_LIFE_FAIL_OPEN) {
      return {
        ok: true,
        balance: arcadeSession?.lastKnownBalance ?? null,
        chargedAmount: pricePerLife,
        reason: "fail_open_rpc_exception"
      };
    }
    return {
      ok: false,
      balance: arcadeSession?.lastKnownBalance ?? null,
      chargedAmount: 0,
      reason: "payment_rpc_exception"
    };
  }
}
function requestArcadeLifePurchase(player, target, keyCode, reason = "start") {
  if (!arcadeSession?.active) return;
  if (!player || !target) return;
  const sessionRef = arcadeSession;
  if (sessionRef.purchaseInFlight[player]) return;
  const now = Date.now();
  const lastAt = Number(sessionRef.lastChargeAt[player] || 0);
  if (now - lastAt < ARCADE_LIFE_DEDUCT_COOLDOWN_MS) return;
  const hasStoredCredit = Number(sessionRef.playerLivesPurchased?.[player] || 0) > 0;
  if (ARCADE_LIFE_DEDUCT_MODE === "unlock_once" && hasStoredCredit) {
    pulseVirtualKey(target, keyCode);
    return;
  }
  sessionRef.lastChargeAt[player] = now;
  sessionRef.purchaseInFlight[player] = true;
  consumeArcadeLifeCharge({ player, reason }).then((result) => {
    if (!arcadeSession?.active || arcadeSession !== sessionRef) return;
    sessionRef.purchaseInFlight[player] = false;
    sessionRef.lastKnownBalance = result.balance;
    if (result.ok) {
      clearArcadeContinueCountdown(player);
      sessionRef.startConfirmUntil[player] = 0;
      sessionRef.playerLivesPurchased[player] = 1;
      scheduleArcadeCreditExpiry(player);
      const priceText2 = getArcadeSessionPrice().toFixed(2);
      const balanceText2 = formatArcadeBalanceForOsd(result.balance);
      pulseVirtualKey(target, keyCode);
      setArcadeOverlayNotice(
        `P${player.slice(1)} ${ARCADE_LIFE_PURCHASE_LABEL} OK -P${priceText2} BAL P${balanceText2}`,
        1800,
        "center"
      );
      showArcadeOsdMessage(
        composeArcadeOsdOverlay(
          `P${player.slice(1)} ${ARCADE_LIFE_PURCHASE_LABEL} Ok -P${priceText2} Balance P${balanceText2}`,
          result.balance
        )
      );
      broadcastArcadeLifeState("charged", {
        player,
        chargedAmount: result.chargedAmount,
        balance: result.balance
      });
      return;
    }
    const priceText = getArcadeSessionPrice().toFixed(2);
    const balanceText = formatArcadeBalanceForOsd(result.balance);
    setArcadeOverlayNotice(`INSUFFICIENT BALANCE`, 2200, "center");
    showArcadeOsdMessage(
      composeArcadeOsdOverlay(
        `Insufficient Balance Needed P${priceText} Balance P${balanceText}`,
        result.balance
      )
    );
    if (ARCADE_LIFE_CONTINUE_SECONDS > 0) {
      setTimeout(() => {
        if (!arcadeSession?.active || arcadeSession !== sessionRef) return;
        if (Number(sessionRef.playerLivesPurchased?.[player] || 0) > 0) return;
        startArcadeContinueCountdown(player);
      }, 1200);
    }
    broadcastArcadeLifeState("denied", {
      player,
      denyReason: result.reason,
      balance: result.balance
    });
  }).catch((err) => {
    if (arcadeSession?.active && arcadeSession === sessionRef) {
      sessionRef.purchaseInFlight[player] = false;
    }
    console.error("[ARCADE LIFE] purchase error", err?.message || err);
    setArcadeOverlayNotice("PAYMENT ERROR - TRY AGAIN", 2200, "center");
    showArcadeOsdMessage("Payment Error - TRY AGAIN");
    broadcastArcadeLifeState("error", { player, denyReason: "purchase_exception" });
  });
}
function handleDepositPulse() {
  const now = Date.now();
  if (depositPulseCount === 0) {
    depositStartTime = now;
    console.log("\n[DEPOSIT] START");
  }
  const gap = depositLastPulseTime ? now - depositLastPulseTime : 0;
  depositLastPulseTime = now;
  depositPulseCount++;
  dispatch({
    type: "COIN",
    credits: 5
  });
  console.log(`[DEPOSIT] PULSE #${depositPulseCount} (+${gap}ms)`);
  if (depositIdleTimer) clearTimeout(depositIdleTimer);
  depositIdleTimer = setTimeout(finalizeDepositCoin, COIN_IDLE_GAP_MS);
}
function finalizeDepositCoin() {
  const pulses = depositPulseCount;
  const duration = Date.now() - depositStartTime;
  resetDepositCoin();
  console.log(`[DEPOSIT] COIN pulses=${pulses} duration=${duration}ms`);
  depositBatchCredits += pulses;
  if (depositBatchTimer) clearTimeout(depositBatchTimer);
  depositBatchTimer = setTimeout(flushDepositBatch, COIN_BATCH_GAP_MS);
}
function flushDepositBatch() {
  if (depositBatchCredits <= 0) return;
  const finalCredits = depositBatchCredits * 5;
  console.log(`[DEPOSIT] BATCH FINAL credits=${finalCredits}`);
  depositBatchCredits = 0;
  depositBatchTimer = null;
}
function resetDepositCoin() {
  depositPulseCount = 0;
  depositIdleTimer = null;
  depositLastPulseTime = 0;
  depositStartTime = 0;
}
var HARD_MAX_MS = 9e4;
function startHopper(amount) {
  if (shuttingDown || hopperActive || amount <= 0) return;
  if (!IS_PI) {
    console.log("[HOPPER] compat-mode simulated payout target=", amount);
    const totalPulses = Math.max(0, Math.ceil(amount / 20));
    let emitted = 0;
    const tick = () => {
      if (emitted >= totalPulses) {
        dispatch({
          type: "WITHDRAW_COMPLETE",
          dispensed: emitted * 20
        });
        return;
      }
      emitted += 1;
      dispatch({
        type: "WITHDRAW_DISPENSE",
        dispensed: 20
      });
      setTimeout(tick, 120);
    };
    tick();
    return;
  }
  hopperActive = true;
  hopperTarget = amount;
  hopperDispensed = 0;
  hopperLastPulseAt = Date.now();
  console.log("[HOPPER] START target=", amount);
  gpioOn(HOPPER_PAY_PIN);
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout);
  }
  hopperNoPulseTimeout = setTimeout(() => {
    if (!hopperActive) return;
    const elapsed = Date.now() - hopperLastPulseAt;
    console.error(`[HOPPER] NO PULSE ${elapsed}ms \u2014 FORCED STOP`);
    stopHopper();
  }, HOPPER_NO_PULSE_TIMEOUT_MS);
  hopperTimeout = setTimeout(
    () => {
      console.error("[HOPPER] TIMEOUT \u2014 FORCED STOP");
      stopHopper();
    },
    Math.min(amount / 20 * 1200, HOPPER_TIMEOUT_MS, HARD_MAX_MS)
  );
}
function handleWithdrawPulse() {
  if (!hopperActive) return;
  hopperLastPulseAt = Date.now();
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout);
  }
  hopperNoPulseTimeout = setTimeout(() => {
    if (!hopperActive) return;
    const elapsed = Date.now() - hopperLastPulseAt;
    console.error(`[HOPPER] NO PULSE ${elapsed}ms \u2014 FORCED STOP`);
    stopHopper();
  }, HOPPER_NO_PULSE_TIMEOUT_MS);
  hopperDispensed += 20;
  console.log(`[HOPPER] DISPENSED ${hopperDispensed}/${hopperTarget}`);
  dispatch({
    type: "WITHDRAW_DISPENSE",
    dispensed: 20
  });
  if (hopperDispensed >= hopperTarget) {
    stopHopper();
  }
}
function stopHopper() {
  if (!hopperActive) return;
  gpioOff(HOPPER_PAY_PIN);
  hopperActive = false;
  if (hopperTimeout) {
    clearTimeout(hopperTimeout);
    hopperTimeout = null;
  }
  if (hopperNoPulseTimeout) {
    clearTimeout(hopperNoPulseTimeout);
    hopperNoPulseTimeout = null;
  }
  hopperLastPulseAt = 0;
  console.log("[HOPPER] STOP dispensed=", hopperDispensed);
  dispatch({
    type: "WITHDRAW_COMPLETE",
    dispensed: hopperDispensed
  });
}
var hopperCtl = null;
function gpioOn(pin) {
  if (!IS_PI) return;
  if (hopperCtl) {
    hopperCtl.kill("SIGTERM");
    hopperCtl = null;
  }
  hopperCtl = (0, import_child_process.spawn)("gpioset", [GPIOCHIP, `${pin}=0`]);
}
function gpioOff(pin) {
  if (!IS_PI) return;
  if (hopperCtl) {
    hopperCtl.kill("SIGTERM");
    hopperCtl = null;
  }
  hopperCtl = (0, import_child_process.spawn)("gpioset", [GPIOCHIP, `${pin}=1`]);
}
var EV_SYN = 0;
var SYN_REPORT = 0;
var EV_KEY = 1;
var EV_ABS = 3;
var BTN_SOUTH = 304;
var BTN_EAST = 305;
var BTN_NORTH = 307;
var BTN_WEST = 308;
var BTN_SELECT = 314;
var BTN_START = 315;
var BTN_TL = 310;
var BTN_TR = 311;
var BTN_DPAD_UP = 544;
var BTN_DPAD_DOWN = 545;
var BTN_DPAD_LEFT = 546;
var BTN_DPAD_RIGHT = 547;
var dpadState = {
  P1: { up: false, down: false, left: false, right: false },
  P2: { up: false, down: false, left: false, right: false }
};
function startVirtualDevice(name) {
  if (!IS_PI) {
    console.log(`[VIRTUAL] compat-mode skipping ${name}`);
    return null;
  }
  const helperPath = process.env.UINPUT_HELPER_PATH || "/opt/arcade/bin/uinput-helper";
  const proc = (0, import_child_process.spawn)(helperPath, [name], {
    stdio: ["pipe", "ignore", "ignore"]
  });
  proc.on("spawn", () => {
    console.log(`[VIRTUAL] ${name} created (pid=${proc.pid})`);
  });
  proc.on("error", (err) => {
    console.error(`[VIRTUAL] ${name} failed (${helperPath})`, err.message);
  });
  return proc;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function getArcadeShellUpdateStatus() {
  return {
    ...arcadeShellUpdateState,
    running: Boolean(arcadeShellUpdateChild),
    triggered: arcadeShellUpdateTriggered
  };
}
function setArcadeShellUpdateState(patch) {
  arcadeShellUpdateState = {
    ...arcadeShellUpdateState,
    ...patch
  };
}
function triggerArcadeShellUpdate(reason = "manual") {
  if (arcadeShellUpdateChild) {
    return { started: false, alreadyRunning: true, status: getArcadeShellUpdateStatus() };
  }
  if (arcadeShellUpdateTriggered) {
    return { started: false, alreadyTriggered: true, status: getArcadeShellUpdateStatus() };
  }
  const updaterPath = process.env.ARCADE_SHELL_UPDATER_BIN || "/usr/local/bin/arcade-shell-updater.mjs";
  if (!import_fs.default.existsSync(updaterPath)) {
    setArcadeShellUpdateState({
      status: "failed",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: `missing updater: ${updaterPath}`,
      reason,
      exitCode: null
    });
    return { started: false, missingUpdater: true, status: getArcadeShellUpdateStatus() };
  }
  arcadeShellUpdateTriggered = true;
  setArcadeShellUpdateState({
    status: "running",
    phase: "shell-check",
    label: "Checking for updates",
    detail: null,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    finishedAt: null,
    message: "[arcade-shell-updater] starting",
    reason,
    exitCode: null
  });
  const child = (0, import_child_process.spawn)(updaterPath, ["--manual"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  arcadeShellUpdateChild = child;
  const handleOutput = (chunk) => {
    const statusPrefix = "[arcade-shell-updater:status] ";
    const lines = String(chunk || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;
    for (const line of lines) {
      if (line.startsWith(statusPrefix)) {
        try {
          const payload = JSON.parse(line.slice(statusPrefix.length));
          const nextState = {};
          if (typeof payload.phase === "string") nextState.phase = payload.phase;
          if (typeof payload.label === "string") nextState.label = payload.label;
          if ("detail" in payload) {
            nextState.detail = typeof payload.detail === "string" && payload.detail.trim() ? payload.detail : null;
          }
          if (typeof payload.message === "string") {
            nextState.message = payload.message;
          } else if (typeof payload.label === "string") {
            nextState.message = [payload.label, payload.detail].filter(Boolean).join(": ");
          }
          if (typeof payload.completed === "number") nextState.completed = payload.completed;
          if (typeof payload.total === "number") nextState.total = payload.total;
          setArcadeShellUpdateState(nextState);
          continue;
        } catch (error) {
          console.warn("[arcade-shell-updater] failed to parse status line", error);
        }
      }
      setArcadeShellUpdateState({ message: line });
      console.log(line);
    }
  };
  child.stdout.on("data", handleOutput);
  child.stderr.on("data", handleOutput);
  child.on("error", (err) => {
    arcadeShellUpdateChild = null;
    setArcadeShellUpdateState({
      status: "failed",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: err.message,
      exitCode: null
    });
  });
  child.on("exit", (code) => {
    arcadeShellUpdateChild = null;
    setArcadeShellUpdateState({
      status: code === 0 ? "completed" : "failed",
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      exitCode: code
    });
  });
  return { started: true, status: getArcadeShellUpdateStatus() };
}
async function startVirtualDevices() {
  virtualP1 = startVirtualDevice("Arcade Virtual P1");
  await sleep(VIRTUAL_DEVICE_STAGGER_MS);
  virtualP2 = startVirtualDevice("Arcade Virtual P2");
  console.log("[VIRTUAL] P1 then P2 initialized");
}
function mapIndexToKey(index) {
  switch (index) {
    case 0:
      return BTN_SOUTH;
    case 1:
      return BTN_EAST;
    case 2:
      return BTN_NORTH;
    case 3:
      return BTN_WEST;
    case 4:
      return BTN_TL;
    case 5:
      return BTN_TR;
    // Support both legacy 6/7 and modern 8/9 select/start layouts.
    case 6:
    case 8:
      return BTN_SELECT;
    case 7:
    case 9:
      return BTN_START;
    // Some encoders expose dpad as digital buttons.
    case 10:
      return BTN_DPAD_UP;
    case 11:
      return BTN_DPAD_DOWN;
    case 12:
      return BTN_DPAD_LEFT;
    case 13:
      return BTN_DPAD_RIGHT;
    default:
      return null;
  }
}
function resolveRetroInputSource(source) {
  if (source === "CASINO" && RETROARCH_PRIMARY_INPUT === "CASINO") {
    return "P1";
  }
  return source;
}
function getRetroVirtualTarget(source) {
  const mapped = resolveRetroInputSource(source);
  if (mapped === "P1") return virtualP1;
  if (mapped === "P2") return virtualP2;
  return null;
}
function canAcceptRetroarchStop() {
  if (!retroarchActive) return false;
  if (!retroarchStartedAt) return true;
  return Date.now() - retroarchStartedAt >= RETROARCH_EXIT_GUARD_MS;
}
function clearRetroarchExitConfirm() {
  retroarchExitConfirmUntil = 0;
  if (arcadeOverlayNotice?.slot === "center" && arcadeOverlayNotice?.text === "EXIT GAME?") {
    clearArcadeOverlayNotice();
  }
}
function handleRetroarchMenuExitIntent() {
  if (!CASINO_MENU_EXITS_RETROARCH) return false;
  if (retroarchStopping) {
    console.warn("[LAUNCH] Ignored \u2014 RetroArch stopping");
    return true;
  }
  if (!canAcceptRetroarchStop()) {
    console.log("[RETROARCH] MENU ignored by guard", {
      elapsedMs: retroarchStartedAt ? Date.now() - retroarchStartedAt : null,
      guardMs: RETROARCH_EXIT_GUARD_MS
    });
    return true;
  }
  const now = Date.now();
  if (retroarchExitConfirmUntil > now) {
    clearRetroarchExitConfirm();
    requestRetroarchStop("menu");
    return true;
  }
  retroarchExitConfirmUntil = now + RETROARCH_EXIT_CONFIRM_WINDOW_MS;
  setArcadeOverlayNotice("EXIT GAME?", RETROARCH_EXIT_CONFIRM_WINDOW_MS, "center");
  showArcadeOsdMessage(composeArcadeOsdOverlay("Press [MENU] Again To Exit"), {
    bypassCooldown: true
  });
  console.log("[RETROARCH] MENU exit armed", {
    windowMs: RETROARCH_EXIT_CONFIRM_WINDOW_MS
  });
  return true;
}
function sendVirtual(proc, type, code, value) {
  if (!proc || !proc.stdin.writable) return;
  proc.stdin.write(`${type} ${code} ${value}
`);
  proc.stdin.write(`${EV_SYN} ${SYN_REPORT} 0
`);
}
function getJsIndexFromSymlink(path2) {
  try {
    const target = import_fs.default.readlinkSync(path2);
    const match = target.match(/(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
var INPUT_DEVICE_RETRY_MISSING_MS = 250;
var INPUT_DEVICE_RETRY_ERROR_MS = 1e3;
var waitingInputDevices = /* @__PURE__ */ new Set();
function logInputLinks(reason = "snapshot") {
  console.log("[INPUT LINK]", {
    reason,
    casino: getJsIndexFromSymlink("/dev/input/casino"),
    player1: getJsIndexFromSymlink("/dev/input/player1"),
    player2: getJsIndexFromSymlink("/dev/input/player2")
  });
}
logInputLinks("boot");
function startEventDevice(path2, label) {
  if (!IS_PI) {
    console.log(`[${label}] compat-mode skipping ${path2}`);
    return;
  }
  if (!import_fs.default.existsSync(path2)) {
    if (!waitingInputDevices.has(path2)) {
      waitingInputDevices.add(path2);
      console.log(`[WAIT] ${label} waiting for ${path2}`);
      logInputLinks(`${label.toLowerCase()}-waiting`);
    }
    return setTimeout(() => startEventDevice(path2, label), INPUT_DEVICE_RETRY_MISSING_MS);
  }
  if (waitingInputDevices.delete(path2)) {
    console.log(`[READY] ${label} detected ${path2}`);
    logInputLinks(`${label.toLowerCase()}-ready`);
  }
  console.log(`[${label}] Opening ${path2}`);
  import_fs.default.open(path2, "r", (err, fd) => {
    if (err) {
      console.error(`[${label}] open error`, err);
      return setTimeout(() => startEventDevice(path2, label), INPUT_DEVICE_RETRY_ERROR_MS);
    }
    const buffer = Buffer.alloc(24);
    function readLoop() {
      import_fs.default.read(fd, buffer, 0, 24, null, (err2, bytesRead) => {
        if (err2 || bytesRead !== 24) {
          console.error(`[${label}] read error`);
          import_fs.default.close(fd, () => {
          });
          return setTimeout(() => startEventDevice(path2, label), INPUT_DEVICE_RETRY_ERROR_MS);
        }
        const type = buffer.readUInt16LE(16);
        const code = buffer.readUInt16LE(18);
        const value = buffer.readInt32LE(20);
        handleRawEvent(label, type, code, value);
        readLoop();
      });
    }
    readLoop();
  });
}
function handleRawEvent(source, type, code, value) {
  if (type === EV_KEY) {
    const index = resolveKeyName(code);
    if (index === null) return;
    handleKey(source, index, value);
  }
  if (type === EV_ABS) {
    handleRawAxis(source, code, value);
  }
}
function resolveKeyName(code) {
  const index = RAW_BUTTON_MAP[code];
  if (index === void 0) return null;
  return index;
}
function handleRawAxis(source, code, value) {
  const DEAD_LOW = 40;
  const DEAD_HIGH = 215;
  if (!retroarchActive) {
    if (code === 0) {
      if (value < DEAD_LOW) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick LEFT");
        }
        dispatch({ type: "PLAYER", player: source, button: "LEFT" });
      } else if (value > DEAD_HIGH) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick RIGHT");
        }
        dispatch({ type: "PLAYER", player: source, button: "RIGHT" });
      }
    }
    if (code === 1) {
      if (value < DEAD_LOW) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick UP");
        }
        dispatch({ type: "PLAYER", player: source, button: "UP" });
      } else if (value > DEAD_HIGH) {
        if (source === "P1") {
          console.log("[MODAL DEBUG] P1 joystick DOWN");
        }
        dispatch({ type: "PLAYER", player: source, button: "DOWN" });
      }
    }
    return;
  }
  const mappedSource = resolveRetroInputSource(source);
  const target = getRetroVirtualTarget(source);
  if (!target || !retroarchActive) return;
  if (isArcadePlayerLocked(source)) {
    const state2 = dpadState[mappedSource];
    if (state2.up) {
      state2.up = false;
      sendVirtual(target, EV_KEY, BTN_DPAD_UP, 0);
    }
    if (state2.down) {
      state2.down = false;
      sendVirtual(target, EV_KEY, BTN_DPAD_DOWN, 0);
    }
    if (state2.left) {
      state2.left = false;
      sendVirtual(target, EV_KEY, BTN_DPAD_LEFT, 0);
    }
    if (state2.right) {
      state2.right = false;
      sendVirtual(target, EV_KEY, BTN_DPAD_RIGHT, 0);
    }
    return;
  }
  const state = dpadState[mappedSource];
  function press(keyName, keyCode) {
    if (state[keyName]) return;
    state[keyName] = true;
    sendVirtual(target, EV_KEY, keyCode, 1);
  }
  function release(keyName, keyCode) {
    if (!state[keyName]) return;
    state[keyName] = false;
    sendVirtual(target, EV_KEY, keyCode, 0);
  }
  if (code === 0) {
    if (value < DEAD_LOW) {
      press("left", BTN_DPAD_LEFT);
      release("right", BTN_DPAD_RIGHT);
    } else if (value > DEAD_HIGH) {
      press("right", BTN_DPAD_RIGHT);
      release("left", BTN_DPAD_LEFT);
    } else {
      release("left", BTN_DPAD_LEFT);
      release("right", BTN_DPAD_RIGHT);
    }
  }
  if (code === 1) {
    if (value < DEAD_LOW) {
      press("up", BTN_DPAD_UP);
      release("down", BTN_DPAD_DOWN);
    } else if (value > DEAD_HIGH) {
      press("down", BTN_DPAD_DOWN);
      release("up", BTN_DPAD_UP);
    } else {
      release("up", BTN_DPAD_UP);
      release("down", BTN_DPAD_DOWN);
    }
  }
}
function handleKey(source, index, value) {
  if (index === void 0 || index === null) return;
  if (source === "CASINO") {
    const casinoAction = JOYSTICK_BUTTON_MAP[index];
    if (retroarchActive && isBlockedCasinoActionDuringRetroarch(casinoAction)) {
      console.log(`[CASINO] blocked during RetroArch: ${casinoAction}`);
      return;
    }
    if (retroarchActive && RETROARCH_PRIMARY_INPUT === "CASINO") {
      if (value === 1 && JOYSTICK_BUTTON_MAP[index] === "MENU" && CASINO_MENU_EXITS_RETROARCH) {
        handleRetroarchMenuExitIntent();
        return;
      }
      routePlayerInput("P1", index, value);
      return;
    }
    if (retroarchActive && arcadeSession?.active && isLifePurchaseButton(index)) {
      const primaryPlayer = normalizeArcadePlayer(RETROARCH_PRIMARY_INPUT) || "P1";
      routePlayerInput(primaryPlayer, index, value);
      return;
    }
    if (retroarchActive && arcadeSession?.active) {
      const primaryPlayer = normalizeArcadePlayer(RETROARCH_PRIMARY_INPUT) || "P1";
      const primaryLocked = !playerHasStoredCredit(primaryPlayer);
      const casinoAction2 = JOYSTICK_BUTTON_MAP[index];
      if (primaryLocked) {
        if (casinoAction2 === "MENU" && CASINO_MENU_EXITS_RETROARCH) {
          if (value === 1) handleRetroarchMenuExitIntent();
          return;
        }
        if (!isAllowedLockedInput(index)) {
          if (value === 1) {
            const priceText = getArcadeSessionPrice().toFixed(2);
            const actionLabel = getArcadeLifePromptActionLabel();
            showArcadeOsdMessage(
              composeArcadeOsdOverlay(
                `P${primaryPlayer.slice(1)} LOCKED INPUT ${actionLabel} (P${priceText})`
              )
            );
          }
          return;
        }
      }
    }
    if (!retroarchActive && value === 1) {
      if (index === 7) {
        dispatch({ type: "PLAYER", player: "CASINO", button: 7 });
        return;
      }
    }
    if (value !== 1) return;
    if (retroarchActive && casinoAction === "MENU" && CASINO_MENU_EXITS_RETROARCH) {
      handleRetroarchMenuExitIntent();
      return;
    }
    switch (casinoAction) {
      case "COIN":
        handleDepositPulse();
        break;
      case "HOPPER_COIN":
        dispatch({
          type: "HOPPER_COIN",
          amount: HOPPER_TOPUP_COIN_VALUE
        });
        break;
      case "WITHDRAW_COIN":
        handleWithdrawPulse();
        break;
      default:
        dispatch({ type: "ACTION", action: casinoAction });
        break;
    }
    return;
  }
  routePlayerInput(source, index, value);
}
function routePlayerInput(source, index, value) {
  const keyCode = mapIndexToKey(index);
  if (!keyCode) return;
  if (retroarchActive) {
    const target = getRetroVirtualTarget(source);
    if (!target) return;
    const player = normalizeArcadePlayer(source);
    if (!player) return;
    const hasStoredCredit = playerHasStoredCredit(player);
    const needsCredit = !hasStoredCredit;
    if (needsCredit && !isAllowedLockedInput(index)) {
      if (value === 1) {
        const priceText = getArcadeSessionPrice().toFixed(2);
        const actionLabel = getArcadeLifePromptActionLabel();
        showArcadeOsdMessage(
          composeArcadeOsdOverlay(
            `P${player.slice(1)} LOCKED INPUT ${actionLabel} (P${priceText})`
          )
        );
        if (ARCADE_LIFE_CONTINUE_SECONDS > 0) {
          startArcadeContinueCountdown(player);
          broadcastArcadeLifeState("locked", {
            player,
            continueSeconds: ARCADE_LIFE_CONTINUE_SECONDS
          });
        } else {
          broadcastArcadeLifeState("locked", { player });
        }
      }
      return;
    }
    if (arcadeSession?.active) {
      const player3 = normalizeArcadePlayer(source);
      if (!player3) return;
      const hasStoredCredit2 = playerHasStoredCredit(player3);
      const needsCredit2 = !hasStoredCredit2;
      if (isLifePurchaseButton(index)) {
        if (value === 1) {
          const hasStoredCredit3 = playerHasStoredCredit(player3);
          if (!hasStoredCredit3) {
            arcadeSession.startConfirmUntil[player3] = 0;
            requestArcadeLifePurchase(player3, target, BTN_START, "buy_button");
          } else {
            showArcadeOsdMessage(
              composeArcadeOsdOverlay(`P${player3.slice(1)} ALREADY HAS CREDIT`),
              {
                bypassCooldown: true
              }
            );
          }
        }
        return;
      }
      if (isStartButton(index)) {
        if (value === 1) {
          clearRetroarchExitConfirm();
        }
        if (needsCredit2) {
          if (value === 1) {
            const now = Date.now();
            const confirmUntil = Number(arcadeSession.startConfirmUntil?.[player3] || 0);
            if (confirmUntil > now) {
              arcadeSession.startConfirmUntil[player3] = 0;
              requestArcadeLifePurchase(player3, target, keyCode, "start_button");
            } else {
              arcadeSession.startConfirmUntil[player3] = now + ARCADE_LIFE_START_CONFIRM_WINDOW_MS;
              setArcadeOverlayNotice(
                "START GAME?",
                ARCADE_LIFE_START_CONFIRM_WINDOW_MS,
                player3 === "P1" ? "left" : "right"
              );
              showArcadeOsdMessage(composeArcadeOsdOverlay("START GAME?"), {
                bypassCooldown: true
              });
              broadcastArcadeLifeState("start_confirm_required", {
                player: player3,
                confirmWindowMs: ARCADE_LIFE_START_CONFIRM_WINDOW_MS,
                balance: arcadeSession.lastKnownBalance
              });
            }
          }
          return;
        }
        arcadeSession.startConfirmUntil[player3] = 0;
        if (arcadeOverlayNotice?.slot === (player3 === "P1" ? "left" : "right")) {
          clearArcadeOverlayNotice();
        }
        sendVirtual(target, EV_KEY, keyCode, value);
        return;
      }
    }
    sendVirtual(target, EV_KEY, keyCode, value);
  } else {
    if (value !== 1) return;
    if (source === "P1" && (index === 0 || index === 1)) {
      console.log(
        `[MODAL DEBUG] P1 button ${index} press (${index === 0 ? "confirm/select" : "dismiss keyboard"})`
      );
    }
    dispatch({
      type: "PLAYER",
      player: source,
      button: index
    });
  }
}
function switchToVT(vt, reason) {
  if (SINGLE_X_MODE) return true;
  if (!RETROARCH_USE_TTY_MODE) return true;
  if (!IS_PI) return true;
  const result = (0, import_child_process.spawnSync)("chvt", [vt], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(
      `[VT] chvt ${vt} failed (${reason})`,
      result.stderr?.trim() || result.error?.message || ""
    );
    return false;
  }
  console.log(`[VT] switched to ${vt} (${reason})`);
  return true;
}
function switchToVTWithRetry(vt, reason, attempts = 5, delayMs = 150) {
  if (SINGLE_X_MODE) return;
  if (!RETROARCH_USE_TTY_MODE) return;
  if (!IS_PI) return;
  let remaining = attempts;
  const attempt = () => {
    const ok = switchToVT(vt, `${reason}#${attempts - remaining + 1}`);
    if (ok) return;
    remaining -= 1;
    if (remaining <= 0) return;
    setTimeout(attempt, delayMs);
  };
  attempt();
}
function scheduleForceSwitchToUI(reason, delayMs = 900) {
  if (SINGLE_X_MODE) return;
  if (!RETROARCH_USE_TTY_MODE || !IS_PI) return;
  if (pendingUiFallbackTimer !== null) {
    clearTimeout(pendingUiFallbackTimer);
    pendingUiFallbackTimer = null;
  }
  const targetUiVT = getTargetUiVT();
  const waitMs = Math.max(0, Math.round(delayMs));
  pendingUiFallbackTimer = setTimeout(() => {
    pendingUiFallbackTimer = null;
    switchToVTWithRetry(targetUiVT, `${reason}-timer`);
    setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-timer-post`), 300);
  }, waitMs);
  console.log(`[VT] scheduled fallback to ${targetUiVT} (${reason})`);
}
function scheduleArcadeCreditExpiry(player) {
  if (!arcadeSession?.active) return;
  if (player !== "P1" && player !== "P2") return;
  clearArcadeCreditExpiry(player);
  if (ARCADE_LIFE_CREDIT_TTL_MS <= 0) return;
  arcadeCreditExpiryTimers[player] = setTimeout(() => {
    if (!arcadeSession?.active) return;
    arcadeSession.playerLivesPurchased[player] = 0;
    arcadeSession.startConfirmUntil[player] = 0;
    releaseAllVirtualInputsForPlayer(player);
    arcadeCreditExpiryTimers[player] = null;
    if (arcadeOverlayNotice?.slot === (player === "P1" ? "left" : "right") || arcadeOverlayNotice?.text === "START GAME?") {
      clearArcadeOverlayNotice();
    }
    showArcadeOsdMessage(composeArcadeOsdOverlay(`P${player.slice(1)} CREDIT CONSUMED`), {
      bypassCooldown: true
    });
    setTimeout(() => {
      if (!arcadeSession?.active) return;
      if (playerHasStoredCredit(player)) return;
      showArcadeOsdMessage(composeArcadeOsdOverlay(""), {
        bypassCooldown: true
      });
    }, 700);
    broadcastArcadeLifeState("credit_consumed", {
      player,
      ttlMs: ARCADE_LIFE_CREDIT_TTL_MS
    });
  }, ARCADE_LIFE_CREDIT_TTL_MS);
}
function clearScheduledForceSwitchToUI() {
  if (pendingUiFallbackTimer === null) return;
  clearTimeout(pendingUiFallbackTimer);
  pendingUiFallbackTimer = null;
}
function clearRetroarchStopTimers() {
  if (retroarchStopTermTimer !== null) {
    clearTimeout(retroarchStopTermTimer);
    retroarchStopTermTimer = null;
  }
  if (retroarchStopForceTimer !== null) {
    clearTimeout(retroarchStopForceTimer);
    retroarchStopForceTimer = null;
  }
}
var arcadeOverlayNotice = null;
var arcadeOverlayNoticeTimer = null;
function clearArcadeOverlayNotice() {
  if (arcadeOverlayNoticeTimer !== null) {
    clearTimeout(arcadeOverlayNoticeTimer);
    arcadeOverlayNoticeTimer = null;
  }
  arcadeOverlayNotice = null;
  refreshArcadeOsdMessage();
}
function setArcadeOverlayNotice(text, ttlMs = 1600, slot = "center") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    clearArcadeOverlayNotice();
    return;
  }
  arcadeOverlayNotice = {
    text: clean,
    slot: slot === "left" || slot === "right" || slot === "center" ? slot : "center"
  };
  refreshArcadeOsdMessage();
  if (arcadeOverlayNoticeTimer !== null) {
    clearTimeout(arcadeOverlayNoticeTimer);
  }
  arcadeOverlayNoticeTimer = setTimeout(
    () => {
      arcadeOverlayNoticeTimer = null;
      arcadeOverlayNotice = null;
      refreshArcadeOsdMessage();
    },
    Math.max(250, ttlMs)
  );
}
function refreshArcadeOsdMessage() {
  if (!arcadeSession?.active) return;
  const promptMessage = buildArcadePromptMessage();
  if (!promptMessage) return;
  showArcadeOsdMessage(promptMessage, { bypassCooldown: true });
  lastArcadePromptLoopMessage = promptMessage;
  lastArcadePromptLoopSentAt = Date.now();
}
function maybeRestartUiAfterExit(reason) {
  if (!IS_PI || !RETROARCH_USE_TTY_MODE || !RESTART_UI_ON_EXIT || shuttingDown) return;
  const now = Date.now();
  if (now - lastUiRestartAt < UI_RESTART_COOLDOWN_MS) return;
  lastUiRestartAt = now;
  const proc = (0, import_child_process.spawn)("systemctl", ["restart", "arcade-ui.service"], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();
  console.log(`[UI] restart requested after game exit (${reason})`);
}
function killRetroarchProcess(signal, reason) {
  if (!retroarchProcess) return;
  const pid = retroarchProcess.pid;
  try {
    process.kill(-pid, signal);
    console.log(`[RETROARCH] group ${signal} (${reason}) pid=${pid}`);
    return;
  } catch {
  }
  try {
    retroarchProcess.kill(signal);
    console.log(`[RETROARCH] child ${signal} (${reason}) pid=${pid}`);
  } catch (err) {
    console.error("[RETROARCH] kill failed", err.message);
  }
}
function sendRetroarchSignal(signal, reason) {
  if (!retroarchProcess) return;
  killRetroarchProcess(signal, reason);
}
function finalizeRetroarchExit(reason) {
  if (!retroarchActive && !retroarchProcess) return;
  const wasActive = retroarchActive;
  const targetUiVT = getTargetUiVT();
  clearRetroarchStopTimers();
  clearRetroarchExitConfirm();
  retroarchActive = false;
  retroarchStopping = false;
  retroarchProcess = null;
  lastExitTime = Date.now();
  lastExitedGameId = arcadeSession?.gameId || retroarchCurrentGameId || lastExitedGameId;
  retroarchCurrentGameId = null;
  retroarchStartedAt = 0;
  if (retroarchLogFd !== null) {
    try {
      import_fs.default.closeSync(retroarchLogFd);
    } catch {
    }
    retroarchLogFd = null;
  }
  if (SINGLE_X_MODE) {
    restoreChromiumUiAfterRetroarch();
  } else {
    switchToVTWithRetry(targetUiVT, reason);
    setTimeout(() => switchToVTWithRetry(targetUiVT, `${reason}-post`), 450);
    scheduleForceSwitchToUI(`${reason}-detached`);
  }
  if (wasActive) {
    clearArcadeLifeSession(reason);
    dispatch({ type: "GAME_EXITED" });
    setTimeout(() => maybeRestartUiAfterExit(reason), 250);
  }
}
function requestRetroarchStop(reason) {
  clearRetroarchExitConfirm();
  if (!retroarchActive) return;
  const targetUiVT = getTargetUiVT();
  if (!retroarchProcess) {
    console.warn("[RETROARCH] stop requested with no process");
    finalizeRetroarchExit(`${reason}-missing-process`);
    return;
  }
  if (retroarchStopping) return;
  retroarchStopping = true;
  clearRetroarchStopTimers();
  const stopTargetPid = retroarchProcess.pid;
  sendRetroarchSignal("SIGINT", `${reason}-graceful`);
  if (SINGLE_X_MODE) {
    console.log("[DISPLAY] waiting for RetroArch exit on DISPLAY=:0");
  } else {
    console.log(`[VT] waiting for RetroArch exit before returning to ${targetUiVT}`);
  }
  retroarchStopTermTimer = setTimeout(() => {
    retroarchStopTermTimer = null;
    if (!retroarchActive) return;
    if (!retroarchProcess || retroarchProcess.pid !== stopTargetPid) return;
    sendRetroarchSignal("SIGTERM", `${reason}-term-fallback`);
  }, RETROARCH_TERM_FALLBACK_MS);
  retroarchStopForceTimer = setTimeout(() => {
    retroarchStopForceTimer = null;
    if (!retroarchActive) return;
    if (!retroarchProcess || retroarchProcess.pid !== stopTargetPid) return;
    console.warn("[RETROARCH] force-killing hung process");
    killRetroarchProcess("SIGKILL", `${reason}-force`);
    finalizeRetroarchExit(`${reason}-force-ui`);
  }, RETROARCH_STOP_GRACE_MS);
}
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[SYSTEM] SHUTDOWN START");
  try {
    gpioOff(HOPPER_PAY_PIN);
    if (hopperCtl) {
      hopperCtl.kill("SIGTERM");
      hopperCtl = null;
    }
    player1?.removeAllListeners?.();
    player2?.removeAllListeners?.();
    player1?.close?.();
    player2?.close?.();
    clearArcadeLifeSession("shutdown");
    requestRetroarchStop("shutdown");
    clearRetroarchStopTimers();
    clearScheduledForceSwitchToUI();
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
    if (wss) {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
        }
      }
      await new Promise((resolve) => wss.close(resolve));
    }
  } catch (err) {
    console.error("[SHUTDOWN ERROR]", err);
  }
  console.log("[SYSTEM] SHUTDOWN COMPLETE");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  console.log("Process exiting...");
});
if (IS_PI) {
  startVirtualDevices().then(() => {
    startEventDevice("/dev/input/casino", "CASINO");
    startEventDevice("/dev/input/player1", "P1");
    startEventDevice("/dev/input/player2", "P2");
  }).catch((err) => {
    console.error("[BOOT] hardware init failed", err);
    process.exit(1);
  });
} else {
  console.log("[INPUT] compat-mode: hardware readers disabled");
}
var PORT = 5174;
function readHardwareSerial() {
  if (!IS_PI) {
    const host = import_os.default.hostname() || "dev-host";
    return `dev-${host.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24).toLowerCase()}`;
  }
  try {
    const raw = import_fs.default.readFileSync("/sys/firmware/devicetree/base/serial-number");
    return raw.toString("utf8").replace(/\u0000/g, "").replace(/[^a-fA-F0-9]/g, "").trim();
  } catch (err) {
    console.error("[DEVICE] Failed to read hardware serial", err);
    return null;
  }
}
var DEVICE_ID = readHardwareSerial();
if (!DEVICE_ID) {
  console.error("FATAL: No hardware serial found");
  process.exit(1);
}
console.log("[DEVICE] ID =", DEVICE_ID);
function getMimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
import_fs.default.mkdirSync(RUNTIME_GAMES_DIR, { recursive: true });
function sanitizePathSegment(value, fallback = "default") {
  const safe = String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  return safe || fallback;
}
function getRuntimeGameDir(gameId, version) {
  return import_path.default.join(
    RUNTIME_GAMES_DIR,
    sanitizePathSegment(gameId, "game"),
    sanitizePathSegment(version, "1")
  );
}
function getRuntimeGameEntry(gameId, version) {
  const safeId = sanitizePathSegment(gameId, "game");
  const safeVersion = sanitizePathSegment(version, "1");
  return `/runtime-games/${safeId}/${safeVersion}/index.html`;
}
function setJsonCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}
function scheduleSystemPowerAction(action) {
  const command = action === "restart" ? "reboot" : "poweroff";
  console.log(`[SYSTEM] ${command} requested`);
  setTimeout(() => {
    if (!IS_PI) {
      console.log(`[SYSTEM] ${command} simulated (compat mode)`);
      return;
    }
    if (retroarchActive) {
      requestRetroarchStop(`system-${command}`);
    }
    const primary = (0, import_child_process.spawn)("systemctl", [command], {
      stdio: "ignore",
      detached: true
    });
    primary.on("error", (err) => {
      console.error(`[SYSTEM] systemctl ${command} failed, trying fallback`, err.message);
      const fallback = (0, import_child_process.spawn)(command, [], {
        stdio: "ignore",
        detached: true
      });
      fallback.unref();
    });
    primary.unref();
  }, 400);
}
function getPackageKey() {
  const keyHex = process.env.GAME_PACKAGE_KEY_HEX || "";
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) return null;
  return Buffer.from(keyHex, "hex");
}
async function installEncryptedGamePackage({ id, packageUrl, version, force = false }) {
  const key = getPackageKey();
  if (!key) {
    throw new Error("GAME_PACKAGE_KEY_HEX is missing or invalid");
  }
  const gameId = sanitizePathSegment(id, "game");
  const gameVersion = sanitizePathSegment(version, "1");
  const installDir = getRuntimeGameDir(gameId, gameVersion);
  const markerPath = import_path.default.join(installDir, ".installed.json");
  const entryPath = import_path.default.join(installDir, "index.html");
  if (!force && import_fs.default.existsSync(markerPath)) {
    if (normalizeRuntimeIndexHtml(entryPath)) {
      return {
        entry: getRuntimeGameEntry(gameId, gameVersion),
        installed: true,
        cached: true
      };
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3e4);
  let response;
  try {
    response = await fetch(packageUrl, {
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`package download failed: ${response.status}`);
  }
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (encrypted.length < 29) {
    throw new Error("invalid encrypted payload");
  }
  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(12, 28);
  const cipherText = encrypted.subarray(28);
  const decipher = (0, import_crypto.createDecipheriv)("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let plainTar;
  try {
    plainTar = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  } catch {
    throw new Error("decrypt failed: auth check failed");
  }
  import_fs.default.rmSync(installDir, { recursive: true, force: true });
  import_fs.default.mkdirSync(installDir, { recursive: true });
  const tmpTarPath = import_path.default.join(import_os.default.tmpdir(), `arcade-${gameId}-${gameVersion}-${Date.now()}.tar.gz`);
  import_fs.default.writeFileSync(tmpTarPath, plainTar);
  const untar = (0, import_child_process.spawnSync)("tar", ["-xzf", tmpTarPath, "-C", installDir], {
    stdio: "pipe",
    encoding: "utf8"
  });
  import_fs.default.rmSync(tmpTarPath, { force: true });
  if (untar.status !== 0) {
    throw new Error(`extract failed: ${untar.stderr || untar.stdout || untar.status}`);
  }
  if (!import_fs.default.existsSync(entryPath)) {
    throw new Error("invalid package: missing index.html");
  }
  normalizeRuntimeIndexHtml(entryPath);
  import_fs.default.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        gameId,
        version: gameVersion,
        installedAt: (/* @__PURE__ */ new Date()).toISOString(),
        packageSha256: (0, import_crypto.createHash)("sha256").update(encrypted).digest("hex")
      },
      null,
      2
    )
  );
  return {
    entry: getRuntimeGameEntry(gameId, gameVersion),
    installed: true,
    cached: false
  };
}
function normalizeRuntimeIndexHtml(indexPath) {
  if (!import_fs.default.existsSync(indexPath)) return false;
  let html = import_fs.default.readFileSync(indexPath, "utf8");
  const original = html;
  html = html.replace(/(src|href)="\/assets\//g, '$1="./assets/');
  if (html !== original) {
    import_fs.default.writeFileSync(indexPath, html);
  }
  return true;
}
function removeRuntimeGamePackage({ id, version, allVersions = false }) {
  const gameId = sanitizePathSegment(id, "game");
  if (allVersions) {
    const gameRoot = import_path.default.join(RUNTIME_GAMES_DIR, gameId);
    import_fs.default.rmSync(gameRoot, { recursive: true, force: true });
    return { removed: true, path: gameRoot };
  }
  const gameVersion = sanitizePathSegment(version, "1");
  const installDir = getRuntimeGameDir(gameId, gameVersion);
  import_fs.default.rmSync(installDir, { recursive: true, force: true });
  return { removed: true, path: installDir };
}
function purgeRuntimeGamePackages() {
  import_fs.default.rmSync(RUNTIME_GAMES_DIR, { recursive: true, force: true });
  import_fs.default.mkdirSync(RUNTIME_GAMES_DIR, { recursive: true });
  return { purged: true };
}
function getNetworkInfo() {
  const nets = import_os.default.networkInterfaces();
  const pickIpv4 = (name) => {
    const entries = nets[name] || [];
    const found = entries.find((e) => e && e.family === "IPv4" && !e.internal);
    return found?.address || null;
  };
  return {
    ethernet: pickIpv4("eth0"),
    wifi: pickIpv4("wlan0")
  };
}
function getCoreCandidates(coreValue) {
  const normalized = String(coreValue ?? "").trim().toLowerCase().replace(/\\/g, "/").replace(/^.*\//, "").replace(/\.so$/i, "").replace(/_libretro$/i, "").replace(/-/g, "_");
  const candidates = [];
  if (normalized) {
    candidates.push(normalized);
  }
  if (normalized === "ps1" || normalized === "psx" || normalized === "playstation" || normalized.includes("psx") || normalized.includes("playstation")) {
    candidates.push(...PS1_CORE_ALIASES);
  }
  return Array.from(new Set(candidates));
}
function resolveCorePath(coreValue) {
  const coreCandidates = getCoreCandidates(coreValue);
  const attempted = [];
  for (const coreName of coreCandidates) {
    for (const baseDir of LIBRETRO_DIR_CANDIDATES) {
      const soPath = import_path.default.join(baseDir, `${coreName}_libretro.so`);
      attempted.push(soPath);
      if (import_fs.default.existsSync(soPath)) {
        return { path: soPath, coreName, attempted };
      }
    }
  }
  return { path: null, coreName: null, attempted };
}
function resolveRomPath(romValue) {
  const raw = String(romValue ?? "").trim();
  if (!raw) return null;
  const normalizedRaw = raw.replace(/\\/g, "/").trim();
  const romRelative = normalizedRaw.replace(/^\/+/, "").replace(/^(\.\.\/)+roms\//, "").replace(/^roms\//, "");
  const candidates = [
    raw,
    import_path.default.resolve(SERVICE_DIR, raw),
    import_path.default.resolve(ARCADE_RUNTIME_DIR, raw),
    import_path.default.resolve(ROMS_ROOT, raw),
    import_path.default.join(ROMS_ROOT, romRelative)
  ];
  for (const candidate of candidates) {
    const resolved = import_path.default.resolve(candidate);
    if (import_fs.default.existsSync(resolved)) {
      return resolved;
    }
  }
  console.error("[ROM RESOLVE] not found", {
    raw,
    romRelative,
    serviceDir: SERVICE_DIR,
    runtimeDir: ARCADE_RUNTIME_DIR,
    romsRoot: ROMS_ROOT,
    candidates: candidates.map((candidate) => import_path.default.resolve(candidate))
  });
  return null;
}
var server = import_http.default.createServer((req, res) => {
  if (req.method === "OPTIONS" && req.url.startsWith("/game-package/")) {
    setJsonCors(res);
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && req.url === "/device-id") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ deviceId: DEVICE_ID }));
    return;
  }
  if (req.method === "GET" && req.url === "/network-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getNetworkInfo()));
    return;
  }
  if (req.method === "GET" && req.url === "/arcade-shell-update/status") {
    return sendJson(res, 200, { success: true, ...getArcadeShellUpdateStatus() });
  }
  if (req.method === "GET" && req.url === "/wifi-scan") {
    if (!IS_PI) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify([
          { ssid: "DEV_WIFI", signal: 85 },
          { ssid: "DEV_HOTSPOT", signal: 62 }
        ])
      );
    }
    (0, import_child_process.exec)(
      "sudo nmcli device wifi rescan; sudo nmcli -t --escape no -f SSID,SIGNAL device wifi list --rescan no",
      (err, stdout) => {
        if (err) {
          console.error("[WIFI] Scan failed", err);
          res.writeHead(500);
          return res.end("Error");
        }
        const networks = stdout.split("\n").filter(Boolean).map((line) => {
          const sep = line.lastIndexOf(":");
          if (sep <= 0) return null;
          const ssid = line.slice(0, sep).trim();
          const signal = Number(line.slice(sep + 1));
          return { ssid, signal: Number.isFinite(signal) ? signal : 0 };
        }).filter(Boolean).filter((n) => n.ssid && n.ssid.trim() !== "").sort((a, b) => b.signal - a.signal);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(networks));
      }
    );
    return;
  }
  if (req.method === "GET") {
    const safePath = import_path.default.normalize(req.url).replace(/^(\.\.[\/\\])+/, "");
    if (safePath === "/arcade-shell-build.json") {
      const versionFilePath = import_path.default.join(ARCADE_RUNTIME_DIR, "os", ".arcade-shell-version");
      let version = "";
      let createdAt = null;
      try {
        if (import_fs.default.existsSync(versionFilePath)) {
          version = String(import_fs.default.readFileSync(versionFilePath, "utf8") || "").trim();
          const stats = import_fs.default.statSync(versionFilePath);
          createdAt = stats.mtime.toISOString();
        }
      } catch (err) {
        console.error("Build metadata read error:", err);
      }
      if (!version) {
        version = String(process.env.ARCADE_SHELL_VERSION || "").trim();
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache"
      });
      return res.end(
        JSON.stringify({
          version: version || "unknown",
          created_at: createdAt
        })
      );
    }
    if (safePath === "/boot.png") {
      const bootPath = import_path.default.join(ARCADE_RUNTIME_DIR, "os", "boot", "boot.png");
      if (!import_fs.default.existsSync(bootPath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const data = import_fs.default.readFileSync(bootPath);
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=3600"
        });
        return res.end(data);
      } catch (err) {
        console.error("Boot image read error:", err);
        res.writeHead(500);
        return res.end("Server error");
      }
    }
    if (safePath.startsWith("/roms/")) {
      const romAssetPath = safePath.replace(/^\/roms\//, "");
      const filePath2 = import_path.default.join(ROMS_ROOT, romAssetPath);
      if (!filePath2.startsWith(ROMS_ROOT)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (!import_fs.default.existsSync(filePath2)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const data = import_fs.default.readFileSync(filePath2);
        res.writeHead(200, {
          "Content-Type": getMimeType(filePath2),
          "Cache-Control": "public, max-age=3600"
        });
        return res.end(data);
      } catch (err) {
        console.error("ROM static read error:", err);
        res.writeHead(500);
        return res.end("Server error");
      }
    }
    if (safePath.startsWith("/runtime-games/")) {
      const runtimePath = safePath.replace("/runtime-games/", "");
      let filePath2 = import_path.default.join(RUNTIME_GAMES_DIR, runtimePath);
      if (!filePath2.startsWith(RUNTIME_GAMES_DIR)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      if (safePath.endsWith("/")) {
        filePath2 = import_path.default.join(filePath2, "index.html");
      }
      if (!import_fs.default.existsSync(filePath2)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const data = import_fs.default.readFileSync(filePath2);
        const isHtml = filePath2.endsWith(".html");
        res.writeHead(200, {
          "Content-Type": getMimeType(filePath2),
          "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000"
        });
        return res.end(data);
      } catch (err) {
        console.error("Runtime static read error:", err);
        res.writeHead(500);
        return res.end("Server error");
      }
    }
    let filePath = import_path.default.join(DIST_DIR, safePath === "/" ? "index.html" : safePath);
    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (!import_fs.default.existsSync(filePath)) {
      filePath = import_path.default.join(DIST_DIR, "index.html");
    }
    console.log("Serving:", filePath);
    try {
      const data = import_fs.default.readFileSync(filePath);
      const isHtml = filePath.endsWith(".html");
      res.writeHead(200, {
        "Content-Type": getMimeType(filePath),
        "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000"
      });
      return res.end(data);
    } catch (err) {
      console.error("Static read error:", err);
      res.writeHead(500);
      return res.end("Server error");
    }
  }
  if (req.method === "POST" && req.url === "/wifi-connect") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        const { ssid, password } = JSON.parse(body2 || "{}");
        if (!ssid || !password) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing credentials" }));
        }
        if (!IS_PI) {
          console.log("[WIFI] compat-mode connect accepted for", ssid);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
          broadcast({ type: "INTERNET_RESTORED" });
          return;
        }
        console.log("[WIFI] Attempting connection to", ssid);
        const nm = (0, import_child_process.spawn)("sudo", ["nmcli", "device", "wifi", "connect", ssid, "password", password]);
        nm.on("close", async (code) => {
          if (code !== 0) {
            console.error("[WIFI] nmcli failed with code", code);
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ success: false }));
          }
          setTimeout(async () => {
            const online = await checkInternetOnce();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: online }));
            if (online) {
              broadcast({ type: "INTERNET_RESTORED" });
            }
          }, 3e3);
        });
      } catch (e) {
        console.error("[WIFI] Invalid request", e);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/game-package/prepare") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        setJsonCors(res);
        const { id, packageUrl, version, force } = JSON.parse(body2 || "{}");
        if (!id || !packageUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing id or packageUrl" }));
        }
        const result = await installEncryptedGamePackage({
          id,
          packageUrl,
          version: version ?? 1,
          force: Boolean(force)
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        console.error("[GAME PACKAGE] prepare failed", err);
        setJsonCors(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/game-package/remove") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", async () => {
      try {
        setJsonCors(res);
        const { id, version, allVersions } = JSON.parse(body2 || "{}");
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: false, error: "Missing id" }));
        }
        const result = removeRuntimeGamePackage({
          id,
          version: version ?? 1,
          allVersions: Boolean(allVersions)
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        console.error("[GAME PACKAGE] remove failed", err);
        setJsonCors(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/game-package/purge") {
    try {
      setJsonCors(res);
      const result = purgeRuntimeGamePackages();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      console.error("[GAME PACKAGE] purge failed", err);
      setJsonCors(res);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
    }
  }
  if (req.method === "POST" && req.url === "/system/restart") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        if (body2) JSON.parse(body2);
      } catch {
      }
      sendJson(res, 200, { success: true, action: "restart", scheduled: true });
      scheduleSystemPowerAction("restart");
    });
    return;
  }
  if (req.method === "POST" && req.url === "/system/shutdown") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        if (body2) JSON.parse(body2);
      } catch {
      }
      sendJson(res, 200, { success: true, action: "shutdown", scheduled: true });
      scheduleSystemPowerAction("shutdown");
    });
    return;
  }
  if (req.method === "POST" && req.url === "/arcade-shell-update/run") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      let reason = "manual";
      try {
        const payload = body2 ? JSON.parse(body2) : {};
        if (typeof payload.reason === "string" && payload.reason.trim()) {
          reason = payload.reason.trim();
        }
      } catch {
      }
      const result = triggerArcadeShellUpdate(reason);
      return sendJson(res, 200, { success: true, ...result });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/arcade-life/balance") {
    let body2 = "";
    req.on("data", (chunk) => {
      body2 += chunk;
    });
    req.on("end", () => {
      try {
        const { balance } = JSON.parse(body2 || "{}");
        const nextBalance = toMoney(balance, NaN);
        if (!Number.isFinite(nextBalance)) {
          console.warn("[ARCADE LIFE BALANCE] invalid payload", body2);
          return sendJson(res, 400, { success: false, error: "Invalid balance" });
        }
        console.log("[ARCADE LIFE BALANCE] push", {
          nextBalance,
          active: Boolean(arcadeSession?.active)
        });
        if (arcadeSession?.active) {
          const previous = arcadeSession.lastKnownBalance;
          const changed = previous !== nextBalance;
          arcadeSession.lastKnownBalance = nextBalance;
          if (changed) {
            console.log("[ARCADE LIFE BALANCE] applied", {
              previous,
              next: nextBalance
            });
            broadcastArcadeLifeState("balance_push", { balance: nextBalance });
            showArcadeOsdMessage(composeArcadeOsdOverlay(""), { bypassCooldown: true });
          }
        }
        return sendJson(res, 200, { success: true, balance: nextBalance });
      } catch (err) {
        console.warn("[ARCADE LIFE BALANCE] invalid JSON", err?.message || err);
        return sendJson(res, 400, { success: false, error: "Invalid JSON" });
      }
    });
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}");
      console.log("[INPUT HTTP]", payload);
      if (payload.type === "WITHDRAW") {
        if (retroarchActive) {
          console.log("[HOPPER] blocked HTTP withdraw during RetroArch");
          res.writeHead(409);
          return res.end("Withdraw blocked during RetroArch");
        }
        startHopper(payload.amount);
      }
      if (payload.type === "LAUNCH_GAME") {
        if (typeof payload.core !== "string" || typeof payload.rom !== "string") {
          res.writeHead(400);
          return res.end("Missing core or rom");
        }
        const payloadGameId = String(payload.id || "").trim();
        const payloadGameName = String(payload.name || "").trim();
        const payloadPrice = toMoney(payload.price, ARCADE_LIFE_PRICE_DEFAULT);
        const payloadBalance = toMoney(payload.balance, 0);
        const duplicateLaunchDuringRecovery = Boolean(payloadGameId) && Boolean(lastExitedGameId) && payloadGameId === lastExitedGameId && Date.now() - lastExitTime < RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS;
        let gameProfile = {
          gameId: payloadGameId || import_path.default.basename(payload.rom || "") || "unknown",
          gameName: payloadGameName || payloadGameId || "Arcade Game",
          pricePerLife: payloadPrice > 0 ? payloadPrice : ARCADE_LIFE_PRICE_DEFAULT,
          initialBalance: payloadBalance
        };
        if (payloadGameId) {
          const remoteProfile = await fetchGameProfileForArcadeLife(payloadGameId);
          if (remoteProfile) {
            gameProfile = {
              ...remoteProfile,
              initialBalance: payloadBalance
            };
          }
        }
        if (retroarchStopping) {
          console.warn("[LAUNCH] Ignored \u2014 RetroArch stopping");
          res.writeHead(409);
          return res.end("Stopping");
        }
        if (retroarchActive) {
          console.warn("[LAUNCH] Ignored \u2014 RetroArch already active");
          res.writeHead(409);
          return res.end("Already running");
        }
        if (Date.now() - lastExitTime < RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS) {
          if (duplicateLaunchDuringRecovery) {
            console.log("[LAUNCH] Ignored \u2014 duplicate launch during exit recovery", {
              gameId: payloadGameId,
              cooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS
            });
            res.writeHead(409);
            return res.end("Duplicate launch during recovery");
          }
          console.log("[LAUNCH] Ignored \u2014 cooldown", {
            cooldownMs: RETROARCH_POST_EXIT_LAUNCH_COOLDOWN_MS
          });
          res.writeHead(409);
          return res.end("Cooling down");
        }
        if (!IS_PI) {
          console.log("[LAUNCH] compat-mode simulated arcade launch");
          retroarchActive = true;
          retroarchStopping = false;
          clearRetroarchExitConfirm();
          retroarchStartedAt = Date.now();
          startArcadeLifeSession(gameProfile);
          setTimeout(() => {
            finalizeRetroarchExit("compat-simulated");
          }, 250);
          res.writeHead(200);
          return res.end("OK");
        }
        console.log("[LAUNCH] emulator");
        retroarchActive = true;
        retroarchStopping = false;
        retroarchCurrentGameId = gameProfile.gameId;
        clearRetroarchExitConfirm();
        retroarchStartedAt = Date.now();
        const romPath = resolveRomPath(payload.rom);
        if (!romPath) {
          retroarchActive = false;
          retroarchStopping = false;
          retroarchCurrentGameId = null;
          retroarchStartedAt = 0;
          clearArcadeLifeSession("launch-rom-missing");
          console.error("[LAUNCH] ROM not found", { rom: payload.rom });
          res.writeHead(400);
          return res.end(`ROM not found: ${payload.rom}`);
        }
        const core = resolveCorePath(payload.core);
        if (!core.path) {
          retroarchActive = false;
          retroarchStopping = false;
          retroarchCurrentGameId = null;
          retroarchStartedAt = 0;
          clearArcadeLifeSession("launch-core-missing");
          console.error("[LAUNCH] Core not found", {
            core: payload.core,
            attempted: core.attempted
          });
          res.writeHead(400);
          return res.end(`Core not found: ${payload.core}`);
        }
        console.log("[LAUNCH] resolved", {
          core: core.coreName,
          corePath: core.path,
          romPath,
          gameId: gameProfile.gameId,
          pricePerLife: gameProfile.pricePerLife
        });
        startArcadeLifeSession(gameProfile);
        retroarchLogFd = import_fs.default.openSync(RETROARCH_LOG_PATH, "a");
        clearScheduledForceSwitchToUI();
        if (SINGLE_X_MODE) {
          hideChromiumUiForRetroarch();
          console.log("[DISPLAY] launching RetroArch into DISPLAY=:0");
        } else {
          const activeVT = getActiveVT();
          if (activeVT) {
            lastUiVT = activeVT;
            console.log(`[VT] captured UI VT ${lastUiVT} before launch`);
          }
          switchToVT(GAME_VT, "launch");
        }
        const command = ["-u", RETROARCH_RUN_USER, "env"];
        if (SINGLE_X_MODE) {
          command.push("DISPLAY=:0", `XAUTHORITY=${RETROARCH_RUN_HOME}/.Xauthority`);
        } else {
          command.push("-u", "DISPLAY", "-u", "XAUTHORITY", "-u", "WAYLAND_DISPLAY");
        }
        command.push(
          `XDG_RUNTIME_DIR=${RETROARCH_RUNTIME_DIR}`,
          `DBUS_SESSION_BUS_ADDRESS=${RETROARCH_DBUS_ADDRESS}`,
          `PULSE_SERVER=${RETROARCH_PULSE_SERVER}`
        );
        if (RETROARCH_USE_DBUS_RUN_SESSION) command.push("dbus-run-session", "--");
        command.push("retroarch", "--fullscreen", "--verbose");
        if (RETROARCH_CONFIG_PATH) {
          command.push("--config", RETROARCH_CONFIG_PATH);
        }
        command.push("-L", core.path, romPath);
        console.log("[LAUNCH] sudo argv", command);
        retroarchProcess = (0, import_child_process.spawn)("sudo", command, {
          stdio: ["ignore", retroarchLogFd, retroarchLogFd],
          detached: true
        });
        retroarchProcess.unref();
        retroarchProcess.on("error", (err) => {
          console.error("[PROCESS] RetroArch spawn error", err.message);
          retroarchCurrentGameId = null;
          clearArcadeLifeSession("spawn-error");
          finalizeRetroarchExit("spawn-error");
        });
        retroarchProcess.on("exit", (code, signal) => {
          console.log(`[PROCESS] RetroArch exited code=${code} signal=${signal}`);
          finalizeRetroarchExit("normal-exit");
        });
      }
      res.writeHead(200);
      res.end("OK");
    } catch (err) {
      console.error("[INPUT HTTP] Invalid JSON", err);
      res.writeHead(400);
      res.end("Invalid JSON");
    }
  });
});
serverInstance = server.listen(PORT, "127.0.0.1", () => {
  console.log(`[INPUT HTTP] Listening on http://localhost:${PORT}`);
});
var lastInternetState = null;
var internetFailStreak = 0;
var internetOkStreak = 0;
function checkInternetOnce() {
  return new Promise((resolve) => {
    (0, import_child_process.exec)(
      `curl -s --max-time ${INTERNET_PROBE_TIMEOUT_SEC} https://clients3.google.com/generate_204`,
      (err) => {
        resolve(!err);
      }
    );
  });
}
var checkingNetwork = false;
async function monitorInternet() {
  if (checkingNetwork) return;
  checkingNetwork = true;
  const online = await checkInternetOnce();
  checkingNetwork = false;
  if (lastInternetState === null) {
    lastInternetState = online;
    internetOkStreak = online ? 1 : 0;
    internetFailStreak = online ? 0 : 1;
    return;
  }
  if (online) {
    internetOkStreak += 1;
    internetFailStreak = 0;
  } else {
    internetFailStreak += 1;
    internetOkStreak = 0;
  }
  if (lastInternetState && internetFailStreak >= INTERNET_FAIL_THRESHOLD) {
    lastInternetState = false;
    internetFailStreak = 0;
    console.warn("[NETWORK] Internet LOST");
    broadcast({ type: "INTERNET_LOST" });
    return;
  }
  if (!lastInternetState && internetOkStreak >= INTERNET_RESTORE_THRESHOLD) {
    lastInternetState = true;
    internetOkStreak = 0;
    console.log("[NETWORK] Internet RESTORED");
    broadcast({ type: "INTERNET_RESTORED" });
  }
}
var wifiReading = false;
function readWifiSignal() {
  if (wifiReading) return;
  wifiReading = true;
  if (!IS_PI) {
    const info = getNetworkInfo();
    const connected = Boolean(info.ethernet || info.wifi);
    wifiReading = false;
    broadcastWifi({
      type: "WIFI_STATUS",
      connected,
      signal: null,
      ssid: info.wifi ? "dev-wifi" : null
    });
    return;
  }
  (0, import_child_process.exec)("nmcli -t -f TYPE,STATE dev", (err, stdout) => {
    if (err || !stdout) {
      wifiReading = false;
      return;
    }
    const lines = stdout.trim().split("\n");
    const wifiConnected = lines.some((line) => {
      const [type, state] = line.split(":");
      return type === "wifi" && state === "connected";
    });
    if (!wifiConnected) {
      wifiReading = false;
      broadcastWifi({ type: "WIFI_STATUS", connected: false, signal: null, ssid: null });
      return;
    }
    (0, import_child_process.exec)(
      "nmcli -t --escape no -f ACTIVE,SSID,SIGNAL dev wifi list --rescan no",
      (err2, stdout2) => {
        wifiReading = false;
        if (err2 || !stdout2) return;
        const activeLine = stdout2.trim().split("\n").find((line) => line.startsWith("yes:"));
        if (!activeLine) {
          broadcastWifi({ type: "WIFI_STATUS", connected: true, signal: null, ssid: null });
          return;
        }
        const signalSep = activeLine.lastIndexOf(":");
        const left = signalSep > -1 ? activeLine.slice(0, signalSep) : activeLine;
        const signalRaw = signalSep > -1 ? activeLine.slice(signalSep + 1) : "";
        const ssid = left.replace(/^yes:/, "").trim() || null;
        const signal = Number(signalRaw ?? 0);
        broadcastWifi({
          type: "WIFI_STATUS",
          connected: true,
          signal: Number.isFinite(signal) ? signal : null,
          ssid
        });
      }
    );
  });
}
var lastWifiState = null;
function broadcastWifi(state) {
  const serialized = JSON.stringify(state);
  if (serialized === lastWifiState) return;
  lastWifiState = serialized;
  broadcast(state);
}
readWifiSignal();
setInterval(readWifiSignal, 5e3);
setInterval(monitorInternet, INTERNET_MONITOR_INTERVAL_MS);
