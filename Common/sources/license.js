/*
 *
 * (c) Copyright Ascensio System Limited 2010-2016
 *
 * This program is freeware. You can redistribute it and/or modify it under the terms of the GNU 
 * General Public License (GPL) version 3 as published by the Free Software Foundation (https://www.gnu.org/copyleft/gpl.html). 
 * In accordance with Section 7(a) of the GNU GPL its Section 15 shall be amended to the effect that 
 * Ascensio System SIA expressly excludes the warranty of non-infringement of any third-party rights.
 *
 * THIS PROGRAM IS DISTRIBUTED WITHOUT ANY WARRANTY; WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR
 * FITNESS FOR A PARTICULAR PURPOSE. For more details, see GNU GPL at https://www.gnu.org/copyleft/gpl.html
 *
 * You can contact Ascensio System SIA by email at sales@onlyoffice.com
 *
 * The interactive user interfaces in modified source and object code versions of ONLYOFFICE must display 
 * Appropriate Legal Notices, as required under Section 5 of the GNU GPL version 3.
 *
 * Pursuant to Section 7 ยง 3(b) of the GNU GPL you must retain the original ONLYOFFICE logo which contains 
 * relevant author attributions when distributing the software. If the display of the logo in its graphic 
 * form is not reasonably feasible for technical reasons, you must include the words "Powered by ONLYOFFICE" 
 * in every copy of the program you distribute. 
 * Pursuant to Section 7 ยง 3(e) we decline to grant you any rights under trademark law for use of our trademarks.
 *
*/
const crypto = require('crypto');
const fs = require('fs');
const config = require('config').get('license');
const constants = require('./constants');

exports.readLicense = function() {
  const resMax = {count: 999999, type: constants.LICENSE_RESULT.Success};
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
      if (endDate >= new Date() && 2 <= oLicense['version']) {
        res.count = Math.min(Math.max(res.count, oLicense['process'] >> 0), resMax.count);
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