import sys
sys.path.append('../build_tools/scripts')
import base
import dependence as _dependence

if (sys.version_info[0] >= 3):
  import winreg
else:
  import _winreg as winreg
    
def get_mysqlServersInfo():
  arrInfo = []
  
  aReg = winreg.ConnectRegistry(None, winreg.HKEY_LOCAL_MACHINE)
  aKey = winreg.OpenKey(aReg, "SOFTWARE\\", 0, winreg.KEY_READ | winreg.KEY_WOW64_32KEY)
  
  try:
    asubkey = winreg.OpenKey(aKey, 'MySQL AB')
    count_subkey = winreg.QueryInfoKey(asubkey)[0]
    
    for i in range(count_subkey):
      MySQLsubkey_name = winreg.EnumKey(asubkey, i)
      if (MySQLsubkey_name.find('MySQL Server') != - 1):
        MySQLsubkey = winreg.OpenKey(asubkey, MySQLsubkey_name)
        dictInfo = {}
        dictInfo['Location']  = winreg.QueryValueEx(MySQLsubkey, 'Location')[0]
        dictInfo['Version'] = winreg.QueryValueEx(MySQLsubkey, 'Version')[0]
        dictInfo['DataLocation'] = winreg.QueryValueEx(MySQLsubkey, 'DataLocation')[0]
        arrInfo.append(dictInfo)
  except:
    pass
      
  return arrInfo

def check_mysqlServer():
  base.print_info('Check MySQL Server')
  
  dependence = _dependence.CDependencies()
  arrInfo = get_mysqlServersInfo()
  
  for info in arrInfo:
    if (base.is_dir(info['Location']) == False):
      continue
      
    version_info = base.run_command('"' + info['Location'] + 'bin\\mysql" --version')['stdout']
    if (version_info.find('for Win64') != -1):
      print('MySQL Server ' + info['Version'] + ' bitness is valid')
      connectionResult = base.run_command('"' + info['Location'] + 'bin\\mysql" -u root -ponlyoffice -e "SHOW GLOBAL VARIABLES LIKE ' + r"'PORT';" + '"')['stdout']
      if (connectionResult.find('port') != -1 and connectionResult.find('3306') != -1):
        print('MySQL Server ' + info['Version'] + ' configuration is valid')
        if (base.run_command('"' + info['Location'] + 'bin\\mysql" -u root -ponlyoffice -e "SHOW DATABASES;"')['stdout'].find('onlyoffice') == -1):
          print('Database onlyoffice not found')
          dependence.append_install('MySQLDatabase')
        if (base.run_command('"' + info['Location'] + 'bin\\mysql" -u root -ponlyoffice -e "SELECT plugin from mysql.user where User=' + "'root';")['stdout'].find('mysql_native_password') == -1):
          print('Password encryption is not valid')
          dependence.append_install('MySQLEncrypt') 
        dependence.pathToValidMySQLServer = info['Location']
        return dependence
      print('MySQL Server ' + info['Version'] + ' configuration is not valid')
    else: 
      print('MySQL Server ' + info['Version'] + ' bitness is not valid')
      
  print('Valid MySQL Server not found')
  
  for info in arrInfo:
    dependence.append_uninstall('MySQL Server')
    dependence.append_removepath(info['DataLocation'])
    
  dependence.append_install('MySQLServer')
  
  return dependence

def check_dependencies():
  final_dependence = _dependence.CDependencies()
  
  final_dependence.append(_dependence.check_nodejs())
  final_dependence.append(_dependence.check_java())
  final_dependence.append(_dependence.check_erlang())
  final_dependence.append(_dependence.check_rabbitmq())
  final_dependence.append(_dependence.check_gruntcli())
  final_dependence.append(_dependence.check_buildTools())
  final_dependence.append(_dependence.check_mysqlInstaller())
  final_dependence.append(check_mysqlServer())
  
  return final_dependence
  
