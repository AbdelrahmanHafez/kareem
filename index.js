'use strict';

function Kareem() {
  this._pres = {};
  this._posts = {};
}

Kareem.prototype.execPre = function(name, context, args, callback) {
  if (arguments.length === 3) {
    callback = args;
    args = [];
  }
  var pres = get(this._pres, name, []);
  var numPres = pres.length;
  var numAsyncPres = pres.numAsync || 0;
  var currentPre = 0;
  var asyncPresLeft = numAsyncPres;
  var done = false;
  var $args = args;

  if (!numPres) {
    return process.nextTick(function() {
      callback(null);
    });
  }

  var next = function() {
    if (currentPre >= numPres) {
      return;
    }
    var pre = pres[currentPre];

    if (pre.isAsync) {
      pre.fn.call(
        context,
        function(error) {
          if (error) {
            if (done) {
              return;
            }
            done = true;
            return callback(error);
          }

          ++currentPre;
          if (asyncPresLeft === 0 && currentPre >= numPres) {
            return callback(null);
          }
          next.apply(context, arguments);
        },
        function(error) {
          if (error) {
            if (done) {
              return;
            }
            done = true;
            return callback(error);
          }
          if (--asyncPresLeft === 0 && currentPre >= numPres) {
            return callback(null);
          }
        });
    } else if (pre.fn.length > 0) {
      var args = [function(error) {
        if (error) {
          if (done) {
            return;
          }
          done = true;
          return callback(error);
        }

        if (++currentPre >= numPres) {
          if (asyncPresLeft > 0) {
            // Leave parallel hooks to run
            return;
          } else {
            return callback(null);
          }
        }

        next.apply(context, arguments);
      }];
      var _args = arguments.length >= 2 ? arguments : [null].concat($args);
      for (var i = 1; i < _args.length; ++i) {
        args.push(_args[i]);
      }
      pre.fn.apply(context, args);
    } else {
      pre.fn.call(context);
      if (++currentPre >= numPres) {
        if (asyncPresLeft > 0) {
          // Leave parallel hooks to run
          return;
        } else {
          return process.nextTick(function() {
            callback(null);
          });
        }
      }
      next();
    }
  };

  next.apply(null, [null].concat(args));
};

Kareem.prototype.execPreSync = function(name, context, args) {
  var pres = get(this._pres, name, []);
  var numPres = pres.length;

  for (var i = 0; i < numPres; ++i) {
    pres[i].fn.apply(context, args || []);
  }
};

Kareem.prototype.execPost = function(name, context, args, options, callback) {
  if (arguments.length < 5) {
    callback = options;
    options = null;
  }
  var posts = get(this._posts, name, []);
  var numPosts = posts.length;
  var currentPost = 0;

  var firstError = null;
  if (options && options.error) {
    firstError = options.error;
  }

  if (!numPosts) {
    return process.nextTick(function() {
      callback.apply(null, [firstError].concat(args));
    });
  }

  var next = function() {
    var post = posts[currentPost];
    var numArgs = 0;
    var argLength = args.length;
    var newArgs = [];
    for (var i = 0; i < argLength; ++i) {
      numArgs += args[i] && args[i]._kareemIgnore ? 0 : 1;
      if (!args[i] || !args[i]._kareemIgnore) {
        newArgs.push(args[i]);
      }
    }

    if (firstError) {
      if (post.length === numArgs + 2) {
        post.apply(context, [firstError].concat(newArgs).concat(function(error) {
          if (error) {
            firstError = error;
          }
          if (++currentPost >= numPosts) {
            return callback.call(null, firstError);
          }
          next();
        }));
      } else {
        if (++currentPost >= numPosts) {
          return callback.call(null, firstError);
        }
        next();
      }
    } else {
      if (post.length === numArgs + 2) {
        // Skip error handlers if no error
        if (++currentPost >= numPosts) {
          return callback.apply(null, [null].concat(args));
        }
        return next();
      }
      if (post.length === numArgs + 1) {
        post.apply(context, newArgs.concat(function(error) {
          if (error) {
            firstError = error;
            return next();
          }

          if (++currentPost >= numPosts) {
            return callback.apply(null, [null].concat(args));
          }

          next();
        }));
      } else {
        post.apply(context, newArgs);

        if (++currentPost >= numPosts) {
          return callback.apply(null, [null].concat(args));
        }

        next();
      }
    }
  };

  next();
};

Kareem.prototype.execPostSync = function(name, context, args) {
  var posts = get(this._posts, name, []);
  var numPosts = posts.length;

  for (var i = 0; i < numPosts; ++i) {
    posts[i].apply(context, args || []);
  }
};

Kareem.prototype.createWrapperSync = function(name, fn) {
  var kareem = this;
  return function syncWrapper() {
    kareem.execPreSync(name, this, arguments);

    var toReturn = fn.apply(this, arguments);

    kareem.execPostSync(name, this, [toReturn]);

    return toReturn;
  };
}

function _handleWrapError(instance, error, name, context, args, options, callback) {
  if (options.useErrorHandlers) {
    var _options = { error: error };
    return instance.execPost(name, context, args, _options, function(error) {
      return typeof callback === 'function' && callback(error);
    });
  } else {
    return typeof callback === 'function' ?
      callback(error) :
      undefined;
  }
}

Kareem.prototype.wrap = function(name, fn, context, args, options) {
  var lastArg = (args.length > 0 ? args[args.length - 1] : null);
  var argsWithoutCb = typeof lastArg === 'function' ?
    args.slice(0, args.length - 1) :
    args;
  var _this = this;

  options = options || {};

  this.execPre(name, context, args, function(error) {
    if (error) {
      var numCallbackParams = options.numCallbackParams || 0;
      var errorArgs = options.contextParameter ? [context] : [];
      for (var i = errorArgs.length; i < numCallbackParams; ++i) {
        errorArgs.push(null);
      }
      return _handleWrapError(_this, error, name, context, errorArgs,
        options, lastArg);
    }

    var end = (typeof lastArg === 'function' ? args.length - 1 : args.length);
    fn.apply(context, args.slice(0, end).concat(function() {
      var args = arguments;
      var argsWithoutError = Array.prototype.slice.call(arguments, 1);
      if (options.nullResultByDefault && argsWithoutError.length === 0) {
        argsWithoutError.push(null);
      }
      if (arguments[0]) {
        // Assume error
        return _handleWrapError(_this, arguments[0], name, context,
          argsWithoutError, options, lastArg);
      } else {
        _this.execPost(name, context, argsWithoutError, function() {
          if (arguments[0]) {
            return typeof lastArg === 'function' ?
              lastArg(arguments[0]) :
              undefined;
          }

          return typeof lastArg === 'function' ?
            lastArg.apply(context, arguments) :
            undefined;
        });
      }
    }));
  });
};

Kareem.prototype.createWrapper = function(name, fn, context, options) {
  var _this = this;
  return function() {
    var _context = context || this;
    var args = Array.prototype.slice.call(arguments);
    _this.wrap(name, fn, _context, args, options);
  };
};

Kareem.prototype.pre = function(name, isAsync, fn, error, unshift) {
  if (typeof arguments[1] !== 'boolean') {
    error = fn;
    fn = isAsync;
    isAsync = false;
  }

  this._pres[name] = get(this._pres, name, []);
  var pres = this._pres[name];

  if (isAsync) {
    pres.numAsync = pres.numAsync || 0;
    ++pres.numAsync;
  }

  if (unshift) {
    pres.unshift({ fn: fn, isAsync: isAsync });
  } else {
    pres.push({ fn: fn, isAsync: isAsync });
  }

  return this;
};

Kareem.prototype.post = function(name, fn, unshift) {
  this._posts[name] = get(this._posts, name, []);

  if (unshift) {
    this._posts[name].unshift(fn);
  } else {
    this._posts[name].push(fn);
  }
  return this;
};

Kareem.prototype.clone = function() {
  const n = new Kareem();

  for (let key of Object.keys(this._pres)) {
    n._pres[key] = this._pres[key].slice();
    n._pres[key].numAsync = this._pres[key].numAsync;
  }
  for (let key of Object.keys(this._posts)) {
    n._posts[key] = this._posts[key].slice();
  }

  return n;
};

Kareem.prototype.merge = function(other) {
  var ret = this.clone();
  for (let key of Object.keys(other._pres)) {
    ret._pres[key] = get(ret._pres, key, []).concat(other._pres[key].slice());
    ret._pres[key].numAsync += other._pres[key].numAsync;
  }
  for (let key of Object.keys(other._posts)) {
    ret._posts[key] = get(ret._posts, key, []).concat(other._posts[key].slice());
  }

  return ret;
};

function get(obj, key, def) {
  if (obj[key] != null) {
    return obj[key];
  }
  return def;
}

module.exports = Kareem;
