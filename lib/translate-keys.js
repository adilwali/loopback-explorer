'use strict';

/**
 * Module dependencies.
 */

// Keys that are different between LDL and Swagger
var KEY_TRANSLATIONS = {
  // LDL : Swagger
  'doc': 'description',
  'default': 'defaultValue',
  'min': 'minimum',
  'max': 'maximum'
};

/**
 * Correct key mismatches between LDL & Swagger.
 * Will modify original object.
 * @param  {Object} object Object on which to change keys.
 * @return {Object}        Translated object.
 */
module.exports = function translateKeys(object) {
  Object.keys(KEY_TRANSLATIONS).forEach(function(LDLKey){
    var val = object[LDLKey];
    if (val) {
      // Should change in Swagger 2.0
      if (LDLKey === 'min' || LDLKey === 'max') {
        val = String(val);
      }
      object[KEY_TRANSLATIONS[LDLKey]] = val;
    }
    delete object[LDLKey];
  });
  return object;
};
