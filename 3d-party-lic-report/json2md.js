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
const { readFile, writeFile } = require("node:fs/promises");

async function startTest() {
  let args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('missing arguments.USAGE: json2md.js [output.md] [input.json]');
    return;
  }
  console.info("3d license report start");
  let outputMd = '';
  let outputFlag = 'a';
  let outputPath = args[0];
  let inputPath = args[1];

  if (inputPath) {
    let licensesText = await readFile(inputPath, 'utf-8');
    let licensesJson = JSON.parse(licensesText);
    console.info("3d license report license count: %d", licensesJson.length);

    for (const element of licensesJson) {
      let name = element['name'];
      let installedVersion = element['installedVersion'];
      let licenseType = element['licenseType'];
      let licenseFileLink = element['licenseFileLink'];
      outputMd += `- ${name} ${installedVersion} ([${licenseType}](${licenseFileLink}))\n`
    }
  } else {
    outputMd = '\n## Third-party\n\n';
    outputFlag = 'w';
  }

  await writeFile(outputPath, outputMd, {flag: outputFlag}, 'utf-8');
  console.info("3d license report end");
}

startTest().catch((err) => {
  console.error(err.stack);
}).finally(() => {
  process.exit(0);
});