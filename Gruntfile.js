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
const path = require('path');
const _ = require('lodash');
var packageFile = require('./package.json');

module.exports = function (grunt) {
  
  let addons = grunt.option('addon') || [];
  if (!Array.isArray(addons))
      addons = [addons];

  addons.forEach((element,index,self) => self[index] = path.join('..', element));
  addons = addons.filter(element => grunt.file.isDir(element));

  function _merge(target, ...sources) {
    if (!sources.length) return target;
      const source = sources.shift();

    for (const key in source) {
      if (_.isObject(source[key])) {
        if (_.isArray(source[key])) {
          if (!_.isArray(target[key])){
            target[key]=[];
          }
          target[key].push(...source[key])
        }
        else { 
          if (!target[key]) {
            Object.assign(target, { [key]: {} }); 
          }
          _merge(target[key], source[key]);
        }
      } 
      else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  addons.forEach(element => {
    let _path = path.join(element, 'package.json');
    if (grunt.file.exists(_path)) {
        _merge(packageFile, require(_path));
        grunt.log.ok('addon '.green + element + ' is merged successfully'.green);
    }
  });

  //grunt.file.write("package-test.json", JSON.stringify(packageFile, null, 4));

  var checkDependencies = {};
   
  for(var i of packageFile.npm) {
    checkDependencies[i] = {
      options: {
        install: true,
        continueAfterInstall: true,
        packageDir: i
      }
    }
  }
  
  grunt.initConfig({
    clean: packageFile.grunt.clean,
    mkdir: packageFile.grunt.mkdir,
    copy: packageFile.grunt.copy,
    comments: {
      js: {
        options: {
          singleline: true,
          multiline: true
        },
        src: packageFile.postprocess.src
      }
    },
    usebanner: {
      copyright: {
        options: {
          position: 'top',
          banner: '/*\n' +
                    ' * Copyright (C) ' + process.env['PUBLISHER_NAME'] + ' 2012-<%= grunt.template.today("yyyy") %>. All rights reserved\n' +
                    ' *\n' +
                    ' * ' + process.env['PUBLISHER_URL'] + ' \n' +
                    ' *\n' +
                    ' * Version: ' + process.env['PRODUCT_VERSION'] + ' (build:' + process.env['BUILD_NUMBER'] + ')\n' +
                    ' */\n',
          linebreak: false
        },
        files: {
          src: packageFile.postprocess.src
        }
      }
    },
    checkDependencies: checkDependencies
  });
  
  grunt.registerTask('build-develop', 'Build develop scripts', function () {
    grunt.initConfig({
      copy: packageFile.grunt["develop-copy"]
    });
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-mkdir');
  grunt.loadNpmTasks('grunt-stripcomments');
  grunt.loadNpmTasks('grunt-banner');
  grunt.loadNpmTasks('grunt-check-dependencies');
  
  grunt.registerTask('default', ['clean', 'mkdir', 'copy', 'comments', 'usebanner', 'checkDependencies']);
  grunt.registerTask('develop', ['build-develop', 'copy']);
};
