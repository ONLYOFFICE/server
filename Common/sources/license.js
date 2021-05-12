/*
 * (c) Copyright Ascensio System SIA 2010-2019
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const constants = require('./constants');
const commonDefines = require('./commonDefines');

const buildDate = '6/29/2016';
const oBuildDate = new Date(buildDate);

exports.readLicense = function*() {
	const c_LR = constants.LICENSE_RESULT;
	return {
		count: 1,
		type: c_LR.Success,
		light: false,
		packageType: constants.PACKAGE_TYPE_OS,
		mode: constants.LICENSE_MODE.None,
		branding: false,
		connections: constants.LICENSE_CONNECTIONS,
		customization: false,
		usersCount: 0,
		usersExpire: constants.LICENSE_EXPIRE_USERS_ONE_DAY,
		hasLicense: false,
		plugins: false,
		buildDate: oBuildDate,
		endDate: null
	};
};
exports.convertToFileParams = function(licenseInfo) {
	// todo
	// {
	// 	user_quota = 0;
	// 	portal_count = 0;
	// 	process = 2;
	// 	ssbranding = false;
	// 	whiteLabel = false;
	// }
	let license = {};
	license.end_date = licenseInfo.endDate && licenseInfo.endDate.toJSON();
	license.trial = constants.LICENSE_MODE.Trial === licenseInfo.mode;
	license.developer = constants.LICENSE_MODE.Developer === licenseInfo.mode;
	switch (licenseInfo.mode) {
		case constants.LICENSE_MODE.Developer:
			license.mode = 'developer';
			break;
		case constants.LICENSE_MODE.Trial:
			license.mode = 'trial';
			break;
		default:
			license.mode = '';
			break;
	}
	license.light = licenseInfo.light;
	license.branding = licenseInfo.branding;
	license.customization = licenseInfo.customization;
	license.plugins = licenseInfo.plugins;
	license.connections = licenseInfo.connections;
	license.users_count = licenseInfo.usersCount;
	license.users_expire = licenseInfo.usersExpire / constants.LICENSE_EXPIRE_USERS_ONE_DAY;
	return license;
};
exports.convertToServerParams = function(licenseInfo) {
	let license = {};
	license.workersCount = licenseInfo.count;
	license.resultType = licenseInfo.type;
	license.packageType = licenseInfo.packageType;
	license.buildDate = licenseInfo.buildDate && licenseInfo.buildDate.toJSON();
	license.buildVersion = commonDefines.buildVersion;
	license.buildNumber = commonDefines.buildNumber;
	return license;
};

exports.packageType = constants.PACKAGE_TYPE_OS;
