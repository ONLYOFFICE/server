import sys
sys.path.append('../build_tools/scripts')
import os
import base
import ctypes
import checks_develop
import subprocess

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
  if base.get_env('PATH').find(sys.exec_prefix) == -1:
    base.set_env('PATH', sys.exec_prefix + os.pathsep + base.get_env('PATH'))
    
  base.cmd_in_dir('./', 'python', ['install_develop.py'])
  
  platform = base.host_platform()
  if ("windows" == platform):
    restart_win_rabbit()
  elif ("mac" == platform):
    start_mac_services()

  base.print_info('Build modules')
  base.cmd_in_dir('../build_tools', 'python', ['configure.py', '--branch', 'develop', '--module', 'develop', '--update', '1', '--update-light', '1', '--clean', '0', '--sdkjs-addon', 'comparison', '--sdkjs-addon', 'content-controls', '--sdkjs-addon', 'pivot-tables', '--web-apps-addon', 'mobile', '--sdkjs-addon', 'sheet-views'])
  base.cmd_in_dir('../build_tools', 'python', ['make.py'])
  
  run_integration_example()
  
  base.create_dir('App_Data')

  base.create_dir('SpellChecker/dictionaries')
  base.copy_dir_content('../dictionaries', 'SpellChecker/dictionaries', '', '.git')

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
  
