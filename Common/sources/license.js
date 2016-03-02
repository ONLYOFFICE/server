const crypto = require('crypto');
const fs = require('fs');
const config = require('config').get('license');
const constants = require('./constants');

exports.readLicense = function() {
  var res = {count: 2, type: constants.LICENSE_RESULT.Error};
  try {
    var oLicense = JSON.parse(fs.readFileSync(config.get('license_file')).toString());
    const sign = oLicense['signature'];
    delete oLicense['signature'];

    const verify = crypto.createVerify('RSA-SHA1');
    verify.update(JSON.stringify(oLicense));
    const publicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDRhGF7X4A0ZVlEg594WmODVVUI\niiPQs04aLmvfg8SborHss5gQXu0aIdUT6nb5rTh5hD2yfpF2WIW6M8z0WxRhwicg\nXwi80H1aLPf6lEPPLvN29EhQNjBpkFkAJUbS8uuhJEeKw0cE49g80eBBF4BCqSL6\nPFQbP9/rByxdxEoAIQIDAQAB\n-----END PUBLIC KEY-----\n';
    if (verify.verify(publicKey, sign, 'hex')) {
      const endDate = new Date(oLicense['end_date']);
      if (endDate >= new Date()) {
        res.count = Math.max(res.count, oLicense['process'] >> 0);
        res.type = constants.LICENSE_RESULT.Success;
      } else {
        res.type = constants.LICENSE_RESULT.Expired;
      }
    }
  } catch(e) {
    res.count = 2;
    res.type = constants.LICENSE_RESULT.Error;
  }
  return res;
};