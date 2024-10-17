/*
 * (c) Copyright Ascensio System SIA 2010-2024
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
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
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

const buildDate = '6/29/2016';
const oBuildDate = new Date(buildDate);

exports.readLicense = async function () {
	const c_LR = constants.LICENSE_RESULT;
	var now = new Date();
	var startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));//first day of current month
	return [{
		count: 1,
		type: c_LR.Success,
		packageType: constants.PACKAGE_TYPE_OS,
		mode: constants.LICENSE_MODE.None,
		branding: false,
		connections: constants.LICENSE_CONNECTIONS,
		connectionsView: constants.LICENSE_CONNECTIONS,
		customization: false,
		advancedApi: false,
		usersCount: 0,
		usersViewCount: 0,
		usersExpire: constants.LICENSE_EXPIRE_USERS_ONE_DAY,
		hasLicense: false,
		buildDate: oBuildDate,
		startDate: startDate,
		endDate: null,
		customerId: "",
		alias: ""
	}, null];
};

exports.packageType = constants.PACKAGE_TYPE_OS;
