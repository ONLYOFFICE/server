/*
 * (c) Copyright Ascensio System SIA 2010-2023
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

"use strict";

const idLanguages = [0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x0009, 0x000a, 0x000b, 0x000c,
	0x000d, 0x000e, 0x000f, 0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017, 0x0018, 0x0019, 0x001a,
	0x001b, 0x001c, 0x001d, 0x001e, 0x001f, 0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, 0x0028,
	0x0029, 0x002a, 0x002b, 0x002c, 0x002d, 0x002e, 0x002f, 0x0032, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0039,
	0x003a, 0x003b, 0x003c, 0x003e, 0x003f, 0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, 0x0048,
	0x0049, 0x004a, 0x004b, 0x004c, 0x004d, 0x004e, 0x004f, 0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0056, 0x0057,
	0x005a, 0x005b, 0x005d, 0x005e, 0x005f, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0068, 0x006a, 0x006b, 0x006c,
	0x006d, 0x006e, 0x006f, 0x0070, 0x0078, 0x007a, 0x007c, 0x007e, 0x0080, 0x0081, 0x0082, 0x0083, 0x0084, 0x0085,
	0x0086, 0x0087, 0x0088, 0x008c, 0x0091, 0x0401, 0x0402, 0x0403, 0x0404, 0x0405, 0x0406, 0x0407, 0x0408, 0x0409,
	0x040a, 0x040b, 0x040c, 0x040d, 0x040e, 0x040f, 0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
	0x0418, 0x0419, 0x041a, 0x041b, 0x041c, 0x041d, 0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425,
	0x0426, 0x0427, 0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f, 0x0430, 0x0431, 0x0432, 0x0433,
	0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043a, 0x043b, 0x043e, 0x043f, 0x0440, 0x0441, 0x0442, 0x0443,
	0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044a, 0x044b, 0x044c, 0x044d, 0x044e, 0x044f, 0x0450, 0x0451,
	0x0452, 0x0453, 0x0454, 0x0455, 0x0456, 0x0457, 0x0458, 0x0459, 0x045a, 0x045b, 0x045c, 0x045d, 0x045e, 0x045f,
	0x0461, 0x0462, 0x0463, 0x0464, 0x0465, 0x0466, 0x0467, 0x0468, 0x0469, 0x046a, 0x046b, 0x046c, 0x046d, 0x046e,
	0x046f, 0x0470, 0x0471, 0x0472, 0x0473, 0x0474, 0x0475, 0x0477, 0x0478, 0x0479, 0x047a, 0x047c, 0x047e, 0x0480,
	0x0481, 0x0482, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0488, 0x048c, 0x048d, 0x0491, 0x0801, 0x0803, 0x0804,
	0x0807, 0x0809, 0x080a, 0x080c, 0x0810, 0x0813, 0x0814, 0x0816, 0x0818, 0x0819, 0x081a, 0x081d, 0x0820, 0x082c,
	0x082e, 0x083b, 0x083c, 0x083e, 0x0843, 0x0845, 0x0846, 0x0850, 0x0851, 0x0859, 0x085d, 0x085f, 0x0861, 0x086b,
	0x0873, 0x0c01, 0x0c04, 0x0c07, 0x0c09, 0x0c0a, 0x0c0c, 0x0c1a, 0x0c3b, 0x0c5f, 0x0c6b, 0x1001, 0x1004, 0x1007,
	0x1009, 0x100a, 0x100c, 0x101a, 0x103b, 0x1401, 0x1404, 0x1407, 0x1409, 0x140a, 0x140c, 0x141a, 0x143b, 0x1801,
	0x1809, 0x180a, 0x180c, 0x181a, 0x183b, 0x1c01, 0x1c09, 0x1c0a, 0x1c0c, 0x1c1a, 0x1c3b, 0x2001, 0x2009, 0x200a,
	0x200c, 0x201a, 0x203b, 0x2401, 0x2409, 0x240a, 0x240c, 0x241a, 0x243b, 0x2801, 0x2809, 0x280a, 0x280c, 0x281a,
	0x2c01, 0x2c09, 0x2c0a, 0x2c0c, 0x2c1a, 0x3001, 0x3009, 0x300a, 0x300c, 0x301a, 0x3401, 0x3409, 0x340a, 0x340c,
	0x3801, 0x3809, 0x380a, 0x380c, 0x3c01, 0x3c09, 0x3c0a, 0x3c0c, 0x4001, 0x4009, 0x400a, 0x4409, 0x440a, 0x4809,
	0x480a, 0x4c0a, 0x500a, 0x540a, 0x641a, 0x681a, 0x6c1a, 0x701a, 0x703b, 0x742c, 0x743b, 0x7804, 0x7814, 0x781a,
	0x782c, 0x783b, 0x7843, 0x7850, 0x785d, 0x7c04, 0x7c14, 0x7c1a, 0x7c28, 0x7c2e, 0x7c3b, 0x7c43, 0x7c50, 0x7c5d,
	0x7c5f, 0x7c68];
const sLanguages = ['ar', 'bg', 'ca', 'zh_Hans', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hu', 'is',
	'it', 'ja', 'ko', 'nl', 'no', 'pl', 'pt', 'rm', 'ro', 'ru', 'hr', 'sk', 'sq', 'sv', 'th', 'tr', 'ur', 'id', 'uk',
	'be', 'sl', 'et', 'lv', 'lt', 'tg', 'fa', 'vi', 'hy', 'az', 'eu', 'hsb', 'mk', 'tn', 'xh', 'zu', 'af', 'ka', 'fo',
	'hi', 'mt', 'se', 'ga', 'ms', 'kk', 'ky', 'sw', 'tk', 'uz', 'tt', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml',
	'as', 'mr', 'sa', 'mn', 'bo', 'cy', 'km', 'lo', 'gl', 'kok', 'syr', 'si', 'iu', 'am', 'tzm', 'ne', 'fy', 'ps',
	'fil', 'dv', 'ha', 'yo', 'quz', 'nso', 'ba', 'lb', 'kl', 'ig', 'ii', 'arn', 'moh', 'br', 'ug', 'mi', 'oc', 'co',
	'gsw', 'sah', 'qut', 'rw', 'wo', 'prs', 'gd', 'ar_SA', 'bg_BG', 'ca_ES', 'zh_TW', 'cs_CZ', 'da_DK', 'de_DE',
	'el_GR', 'en_US', 'es_ES_tradnl', 'fi_FI', 'fr_FR', 'he_IL', 'hu_HU', 'is_IS', 'it_IT', 'ja_JP', 'ko_KR', 'nl_NL',
	'nb_NO', 'pl_PL', 'pt_BR', 'rm_CH', 'ro_RO', 'ru_RU', 'hr_HR', 'sk_SK', 'sq_AL', 'sv_SE', 'th_TH', 'tr_TR', 'ur_PK',
	'id_ID', 'uk_UA', 'be_BY', 'sl_SI', 'et_EE', 'lv_LV', 'lt_LT', 'tg_Cyrl_TJ', 'fa_IR', 'vi_VN', 'hy_AM',
	'az_Latn_AZ', 'eu_ES', 'wen_DE', 'mk_MK', 'st_ZA', 'ts_ZA', 'tn_ZA', 'ven_ZA', 'xh_ZA', 'zu_ZA', 'af_ZA', 'ka_GE',
	'fo_FO', 'hi_IN', 'mt_MT', 'se_NO', 'ms_MY', 'kk_KZ', 'ky_KG', 'sw_KE', 'tk_TM', 'uz_Latn_UZ', 'tt_RU', 'bn_IN',
	'pa_IN', 'gu_IN', 'or_IN', 'ta_IN', 'te_IN', 'kn_IN', 'ml_IN', 'as_IN', 'mr_IN', 'sa_IN', 'mn_MN', 'bo_CN', 'cy_GB',
	'km_KH', 'lo_LA', 'my_MM', 'gl_ES', 'kok_IN', 'mni', 'sd_IN', 'syr_SY', 'si_LK', 'chr_US', 'iu_Cans_CA', 'am_ET',
	'tmz', 'ne_NP', 'fy_NL', 'ps_AF', 'fil_PH', 'dv_MV', 'bin_NG', 'fuv_NG', 'ha_Latn_NG', 'ibb_NG', 'yo_NG', 'quz_BO',
	'nso_ZA', 'ba_RU', 'lb_LU', 'kl_GL', 'ig_NG', 'kr_NG', 'gaz_ET', 'ti_ER', 'gn_PY', 'haw_US', 'so_SO', 'ii_CN',
	'pap_AN', 'arn_CL', 'moh_CA', 'br_FR', 'ug_CN', 'mi_NZ', 'oc_FR', 'co_FR', 'gsw_FR', 'sah_RU', 'qut_GT', 'rw_RW',
	'wo_SN', 'prs_AF', 'plt_MG', 'gd_GB', 'ar_IQ', 'ca_ES_valencia', 'zh_CN', 'de_CH', 'en_GB', 'es_MX', 'fr_BE',
	'it_CH', 'nl_BE', 'nn_NO', 'pt_PT', 'ro_MO', 'ru_MO', 'sr_Latn_CS', 'sv_FI', 'ur_IN', 'az_Cyrl_AZ', 'dsb_DE',
	'se_SE', 'ga_IE', 'ms_BN', 'uz_Cyrl_UZ', 'bn_BD', 'pa_PK', 'mn_Mong_CN', 'bo_BT', 'sd_PK', 'iu_Latn_CA',
	'tzm_Latn_DZ', 'ne_IN', 'quz_EC', 'ti_ET', 'ar_EG', 'zh_HK', 'de_AT', 'en_AU', 'es_ES', 'fr_CA', 'sr_Cyrl_CS',
	'se_FI', 'tmz_MA', 'quz_PE', 'ar_LY', 'zh_SG', 'de_LU', 'en_CA', 'es_GT', 'fr_CH', 'hr_BA', 'smj_NO', 'ar_DZ',
	'zh_MO', 'de_LI', 'en_NZ', 'es_CR', 'fr_LU', 'bs_Latn_BA', 'smj_SE', 'ar_MA', 'en_IE', 'es_PA', 'fr_MC',
	'sr_Latn_BA', 'sma_NO', 'ar_TN', 'en_ZA', 'es_DO', 'fr_West', 'sr_Cyrl_BA', 'sma_SE', 'ar_OM', 'en_JM', 'es_VE',
	'fr_RE', 'bs_Cyrl_BA', 'sms_FI', 'ar_YE', 'en_CB', 'es_CO', 'fr_CG', 'sr_Latn_RS', 'smn_FI', 'ar_SY', 'en_BZ',
	'es_PE', 'fr_SN', 'sr_Cyrl_RS', 'ar_JO', 'en_TT', 'es_AR', 'fr_CM', 'sr_Latn_ME', 'ar_LB', 'en_ZW', 'es_EC',
	'fr_CI', 'sr_Cyrl_ME', 'ar_KW', 'en_PH', 'es_CL', 'fr_ML', 'ar_AE', 'en_ID', 'es_UY', 'fr_MA', 'ar_BH', 'en_HK',
	'es_PY', 'fr_HT', 'ar_QA', 'en_IN', 'es_BO', 'en_MY', 'es_SV', 'en_SG', 'es_HN', 'es_NI', 'es_PR', 'es_US',
	'bs_Cyrl', 'bs_Latn', 'sr_Cyrl', 'sr_Latn', 'smn', 'az_Cyrl', 'sms', 'zh', 'nn', 'bs', 'az_Latn', 'sma', 'uz_Cyrl',
	'mn_Cyrl', 'iu_Cans', 'zh_Hant', 'nb', 'sr', 'tg_Cyrl', 'dsb', 'smj', 'uz_Latn', 'mn_Mong', 'iu_Latn', 'tzm_Latn',
	'ha_Latn'];

const allLanguages = {};
for (let i = 0; i < idLanguages.length; ++i) {
	allLanguages[idLanguages[i]] = sLanguages[i];
}

exports.sToId = function (str) {
	const index = sLanguages.indexOf(str);
	return -1 !== index ? idLanguages[index] : -1;
};
exports.allLanguages = allLanguages;
