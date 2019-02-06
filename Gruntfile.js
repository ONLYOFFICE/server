/*
 * (c) Copyright Ascensio System SIA 2010-2018
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
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
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

var packageFile = require('./package.json');

module.exports = function (grunt) {

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
    pkg: grunt.file.readJSON('package.json'),
    
    clean: {
      options: {
        force: true        
      },
      build: packageFile.build.dest
    },
    mkdir: {
      build: {
        options: {
          create: [packageFile.build.dest]
        },
      },
    },
    copy: {
      main: {
          expand: true,
          src: packageFile.build.src,
          dest: packageFile.build.dest
      }
    },    
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

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-mkdir');
  grunt.loadNpmTasks('grunt-stripcomments');
  grunt.loadNpmTasks('grunt-banner');
  grunt.loadNpmTasks('grunt-check-dependencies');
  
  grunt.registerTask('default', ['clean', 'mkdir', 'copy', 'comments', 'usebanner', 'checkDependencies']);

};