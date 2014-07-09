'use strict';

/**
 * Module dependencies.
 */

var debug = require('debug')('loopback-explorer:routeHelpers');
var _cloneDeep = require('lodash.clonedeep');
var translateKeys = require('./translate-keys');

/**
 * Export the routeHelper singleton.
 */
var routeHelper = module.exports = {
  /**
   * Routes can be translated to API declaration 'operations',
   * but they need a little massaging first. The `accepts` and
   * `returns` declarations need some basic conversions to be compatible. 
   *
   * This method will convert the route and add it to the doc.
   * @param  {Class} class All remoting classes used by the API.
   * @param  {Route} route    Strong Remoting Route object.
   * @param  {Class} classDef Strong Remoting class.
   * @param  {Object} doc     The class's backing API declaration doc.
   */
  addRouteToAPIDeclaration: function (route, classDef, doc) {
    
    // Some fixes to returns/accepts
    var processedRoute = doRouteParameterHacks(route, classDef);

    // Add the api to the spec. If the path already exists, add as another operation
    // under the api; otherwise add a new api.
    addRouteToDoc(processedRoute, doc);
  }
};

/**
 * Given a route, generate an API description and add it to the doc.
 * If a route shares a path with another route (same path, different verb),
 * add it as a new operation under that API description.
 * 
 * @param {Route} route Route.
 * @param {Object} doc  Current document.
 */
function addRouteToDoc(route, doc) {
  var api = routeToAPI(route);
  var matchingAPIs = doc.apis.filter(function(existingAPI) {
    return existingAPI.path === api.path;
  });
  if (matchingAPIs.length) {
    matchingAPIs[0].operations.push(api.operations[0]);
  } else {
    doc.apis.push(api);
  }
}

/**
 * Process a route.
 * Contains some hacks to fix some incompatibilities in the accepts and returns
 * descriptions.
 * @param  {Route} route     A Route.
 * @param  {Class} classDef  The backing strong remoting class.
 */
function doRouteParameterHacks(route, classDef) {
  // Don't modify the existing route as some pieces (such as `returns`) may be shared between routes.
  route = _cloneDeep(route);

  var split = route.method.split('.');
  if (classDef && classDef.sharedCtor && classDef.sharedCtor.accepts && split.length > 2 /* HACK */) {
    route.accepts = (route.accepts || []).concat(classDef.sharedCtor.accepts);
  }

  // Filter out parameters that are generated from the incoming request or body,
  // or generated by functions that use those resources.
  route.accepts = (route.accepts || []).filter(function(arg){
    if (!arg.http) return true;
    // Don't show derived arguments.
    if (typeof arg.http === 'function') return false;
    // Don't show arguments set to the incoming http request or body.
    if (arg.http.source === 'req' || arg.http.source === 'body') return false;
    return true;
  });

  // HACK: makes autogenerated REST routes return the correct model name.
  var returns = route.returns && route.returns[0];
  if (returns && returns.arg === 'data') {
    if (returns.type === 'object') {
      returns.type = classDef.name;
    } else if (returns.type === 'array') {
      returns.type = 'array';
      returns.items = {
        '$ref': classDef.name
      };
    }
  }

  // Translate LDL keys to Swagger keys.
  route.accepts = (route.accepts || []).map(translateKeys);
  route.returns = (route.returns || []).map(translateKeys);

  debug('route %j', route);

  return route;
}

/**
 * Converts from an sl-remoting-formatted "Route" description to a
 * Swagger-formatted "API" description.
 * See https://github.com/wordnik/swagger-spec/blob/master/versions/1.2.md#523-operation-object
 */

function routeToAPI(route) {
  var returnDesc = route.returns && route.returns[0];

  return {
    path: convertPathFragments(route.path),
    operations: [{
      method: convertVerb(route.verb),
      nickname: route.method.replace(/\./g, '_'), // [rfeng] Swagger UI doesn't escape '.' for jQuery selector
      type: returnDesc ? returnDesc.model || prepareDataType(returnDesc.type) : 'void',
      items: returnDesc ? returnDesc.items : '',
      parameters: route.accepts ? route.accepts.map(acceptToParameter(route)) : [],
      responseMessages: [], // TODO(schoon) - We don't have descriptions for this yet.
      summary: route.description, // TODO(schoon) - Excerpt?
      notes: '' // TODO(schoon) - `description` metadata?
    }]
  };
}

function convertPathFragments(path) {
  return path.split('/').map(function (fragment) {
    if (fragment.charAt(0) === ':') {
      return '{' + fragment.slice(1) + '}';
    }
    return fragment;
  }).join('/');
}

function convertVerb(verb) {
  if (verb.toLowerCase() === 'all') {
    return 'POST';
  }

  if (verb.toLowerCase() === 'del') {
    return 'DELETE';
  }

  return verb.toUpperCase();
}

/**
 * A generator to convert from an sl-remoting-formatted "Accepts" description to
 * a Swagger-formatted "Parameter" description.
 */

function acceptToParameter(route) {
  var type = 'form';

  if (route.verb.toLowerCase() === 'get') {
    type = 'query';
  }

  return function (accepts) {
    var name = accepts.name || accepts.arg;
    var paramType = type;

    // TODO: Regex. This is leaky.
    if (route.path.indexOf(':' + name) !== -1) {
      paramType = 'path';
    }

    // Check the http settings for the argument
    if(accepts.http && accepts.http.source) {
        paramType = accepts.http.source;
    }

    var out = {
      paramType: paramType || type,
      name: name,
      description: accepts.description,
      type: accepts.model || prepareDataType(accepts.type),
      required: !!accepts.required,
      defaultValue: accepts.defaultValue,
      minimum: accepts.minimum,
      maximum: accepts.maximum,
      allowMultiple: false
    };

    // HACK: Derive the type from model
    if(out.name === 'data' && out.type === 'object') {
      out.type = route.method.split('.')[0];
    }

    if (out.type === 'array') {
      out.items = {
        type: prepareDataType(accepts.type[0])
      };
    }

    return out;
  };
}

/**
 * Converts from an sl-remoting data type to a Swagger dataType.
 */

function prepareDataType(type) {
  if (!type) {
    return 'void';
  }

  if(Array.isArray(type)) {
    return 'array';
  }

  // TODO(schoon) - Add support for complex dataTypes, "models", etc.
  switch (type) {
    case 'buffer':
      return 'byte';
    case 'date':
      return 'Date';
    case 'number':
      return 'double';
  }

  return type;
}