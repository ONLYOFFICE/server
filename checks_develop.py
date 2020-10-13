import sys
sys.path.append('../build_tools/scripts')
import base
import dependence as _dependence
import os
import subprocess

mysqlParams = _dependence.install_params['MySQLServer']

def check_MySQLConfig(mysqlPath = ''):
  mysqlLoginSrt = _dependence.get_mysqlLoginSrting(mysqlPath)
  
  if (base.run_command(mysqlLoginSrt + ' -e "SHOW DATABASES;"')['stdout'].find('onlyoffice') == -1):
    print('Database onlyoffice not found')
    result1 = execMySQLScript(mysqlPath, os.getcwd() + '\\schema\\mysql\\createdb.sql')
  if (base.run_command(mysqlLoginSrt + ' -e "SELECT plugin from mysql.user where User=' + "'" + mysqlParams['user'] + "';")['stdout'].find('mysql_native_password') == -1):
    print('Password encryption is not valid')
    result2 = set_MySQLEncrypt(mysqlPath, 'mysql_native_password')
  if (result1 == False or result2 == False):
    return False
  return True

def execMySQLScript(mysqlPath, scriptPath):
   print('Execution ' + scriptPath)
   mysqlLoginSrt = _dependence.get_mysqlLoginSrting(mysqlPath)
   
   code = subprocess.call(mysqlLoginSrt + ' -e "source ' + scriptPath + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
   if (code != 0):
    print('Execution was failed!')
    return False
   print('Completed!')

def set_MySQLEncrypt(mysqlPath, sEncrypt):
  print('Setting MySQL password encrypting...')
  mysqlLoginSrt = _dependence.get_mysqlLoginSrting(mysqlPath)
  
  code = subprocess.call(mysqlLoginSrt + ' -e "' + "ALTER USER '" + mysqlParams['user'] + "'@'localhost' IDENTIFIED WITH " + sEncrypt + " BY '" + mysqlParams['pass'] + "';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
  if (code != 0):
    print('Setting password encryption was failed!')
    return False
  print('Completed!')

def check_dependencies():
  final_dependence = _dependence.CDependencies()
  
  final_dependence.append(_dependence.check_nodejs())
  final_dependence.append(_dependence.check_java())
  final_dependence.append(_dependence.check_erlang())
  final_dependence.append(_dependence.check_rabbitmq())
  final_dependence.append(_dependence.check_gruntcli())
  final_dependence.append(_dependence.check_buildTools())
  final_dependence.append(_dependence.check_mysqlInstaller())
  final_dependence.append(_dependence.check_mysqlServer())
  
  return final_dependence
  
