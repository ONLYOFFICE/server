#!/usr/bin/env python
import sys
sys.path.append('../build_tools/scripts')
import os
import base
import subprocess

def check_nodejs_version():
  get_version_command = 'node -v'
  popen = subprocess.Popen(get_version_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
  retvalue = ''
  try:
    stdout, stderr = popen.communicate()
    popen.wait()

    nodejs_version = stdout.strip().decode("utf-8")

  finally:
    popen.stdout.close()
    popen.stderr.close()

  print('Installed Node.js version: ' + nodejs_version)
  nodejs_min_version = 8
  nodejs_cur_version = int(nodejs_version.split('.')[0][1:])
  if (nodejs_min_version > nodejs_cur_version):
    print('Node.js version!', nodejs_min_version, 'more than', nodejs_cur_version, '. Min version Node.js 8.x')
    return False

  return True

def install_module(path):
  base.print_info('Install: ' + path)
  base.cmd_in_dir(path, 'npm', ['install'])

def run_module(directory, args=[]):
  base.run_nodejs_in_dir(directory, args)

def find_rabbitmqctl(base_path):
  return base.find_file(os.path.join(base_path, 'RabbitMQ Server'), 'rabbitmqctl.bat')

def restart_win_rabbit():
  base.print_info('restart RabbitMQ node to prevent "Erl.exe high CPU usage every Monday morning on Windows" https://groups.google.com/forum/#!topic/rabbitmq-users/myl74gsYyYg')
  rabbitmqctl = find_rabbitmqctl(os.environ['ProgramFiles']) or find_rabbitmqctl(os.environ['ProgramFiles(x86)'])
  if rabbitmqctl is not None:
    base.cmd_in_dir(base.get_script_dir(rabbitmqctl), 'rabbitmqctl.bat', ['stop_app'])
    base.cmd_in_dir(base.get_script_dir(rabbitmqctl), 'rabbitmqctl.bat', ['start_app'])
  else:
    base.print_info('Missing rabbitmqctl.bat')

def start_mac_services():
  base.print_info('Restart MySQL Server')
  base.run_process(['mysql.server', 'restart'])
  base.print_info('Start RabbitMQ Server')
  base.run_process(['rabbitmq-server'])
  base.print_info('Start Redis')
  base.run_process(['redis-server'])

def run_integration_example():
  base.cmd_in_dir('../document-server-integration/web/documentserver-example/nodejs', 'python', ['run-develop.py'])

try:
  base.print_info('check Node.js version')
  if (True != check_nodejs_version()):
    exit(0)

  platform = base.host_platform()
  if ("windows" == platform):
    restart_win_rabbit()
  elif ("mac" == platform):
    start_mac_services()

  base.print_info('Build modules')
  base.cmd_in_dir('../build_tools', 'python', ['configure.py', '--branch', 'develop', '--module', 'develop', '--update', '1', '--update-light', '1', '--clean', '0', '--sdkjs-addon', 'comparison', '--sdkjs-addon', 'content-controls', '--web-apps-addon', 'mobile', '--sdkjs-addon', 'sheet-views'])
  base.cmd_in_dir('../build_tools', 'python', ['make.py'])
  
  run_integration_example()
  
  base.create_dir('App_Data')

  install_module('DocService')
  install_module('Common')
  install_module('FileConverter')
  install_module('SpellChecker')

  base.set_env('NODE_ENV', 'development-' + platform)
  base.set_env('NODE_CONFIG_DIR', '../../Common/config')

  if ("mac" == platform):
    base.set_env('DYLD_LIBRARY_PATH', '../../FileConverter/bin/')
  elif ("linux" == platform):
    base.set_env('LD_LIBRARY_PATH', '../../FileConverter/bin/')

  run_module('DocService/sources', ['server.js'])
  run_module('DocService/sources', ['gc.js'])
  run_module('FileConverter/sources', ['convertermaster.js'])
  run_module('SpellChecker/sources', ['server.js'])
except SystemExit:
  input("Ignoring SystemExit. Press Enter to continue...")
