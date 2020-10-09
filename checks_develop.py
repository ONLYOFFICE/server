import sys
sys.path.append('../build_tools/scripts')
import base
import dependence as _dependence

if (sys.version_info[0] >= 3):
  import winreg
else:
  import _winreg as winreg
    
def get_mysqlServersInfo(sParam):
  arrInfo = []
  aReg = winreg.ConnectRegistry(None, winreg.HKEY_LOCAL_MACHINE)
  aKey= winreg.OpenKey(aReg, "SOFTWARE\\", 0, winreg.KEY_READ | winreg.KEY_WOW64_32KEY)
  
  try:
    asubkey = winreg.OpenKey(aKey, 'MySQL AB')
    count_subkey = winreg.QueryInfoKey(asubkey)[0]
    
    for i in range(count_subkey):
      MySQLsubkey_name = winreg.EnumKey(asubkey, i)
      if (MySQLsubkey_name.find('MySQL Server') != - 1):
        MySQLsubkey = winreg.OpenKey(asubkey, MySQLsubkey_name)
        arrInfo.append(winreg.QueryValueEx(MySQLsubkey, sParam)[0])
  except:
    pass
      
  return arrInfo

def check_mysqlServersBitness(MySQLPaths):
  serversBitness = []
  
  for i in range(len(MySQLPaths)):
    mysqlServerPath = MySQLPaths[i]
    result = ""
    if (mysqlServerPath == ""):
      serversBitness.append("")
    else:
      result = base.run_command('"' + mysqlServerPath + 'bin\\mysql" --version')['stdout']
      if (result.find('for Win32') != -1):
        serversBitness.append('x32')
      elif (result.find('for Win64') != -1):
        serversBitness.append('x64')
      else:
        serversBitness.append('')
  return serversBitness
  
def check_mysqlServer(serversBitness, serversVersions, serversPaths, dataPaths):
  dependence = _dependence.CDependencies()
  
  base.print_info('Check MySQL Server')
  for i in range(len(serversBitness)):
    if serversBitness[i] != '':
      break
    if (i == len(serversBitness) - 1): 
      print('MySQL Server not found')
      dependence.install.append('MySQLServer')
      return dependence
    
  for i in range(len(serversBitness)):
    result = serversBitness[i]
    if (result == ""):
      continue 
    elif (result == 'x32'):
      print('MySQL Server ' + serversVersions[i][0:3] + ' bitness is x32, is not valid')
      dependence.uninstall.append('MySQL Server ' + serversVersions[i][0:3])
      continue
    elif (result == 'x64'):
      print('MySQL Server bitness is valid')
      connectionResult = base.run_command('"' + serversPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "SHOW GLOBAL VARIABLES LIKE ' + r"'PORT';" + '"')['stdout']
      if (connectionResult.find('port') != -1 and connectionResult.find('3306') != -1):
        if (base.run_command('"' + serversPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "SHOW DATABASES;"')['stdout'].find('onlyoffice') == -1):
          print('Database onlyoffice not found')
          dependence.install.append('MySQLDatabase')
        if (base.run_command('"' + serversPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "SELECT plugin from mysql.user where User=' + "'root';")['stdout'].find('mysql_native_password') == -1):
          print('Password encryption is not valid')
          dependence.install.append('MySQLEncrypt') 
        dependence.pathToValidMySQLServer = serversPaths[i]
        return dependence
      else:
        print('MySQL Server configuration is not valid')
        dependence.uninstall.append('MySQL Server ' + serversVersions[i][0:3])
        dependence.removePath.append(serversPaths[i])
        dependence.install.append('MySQLServer')
        continue
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
  
  mySQLServersPaths     = get_mysqlServersInfo('Location')
  mySQLServersBitness   = check_mysqlServersBitness(mySQLServersPaths)
  mySQLServersVersions  = get_mysqlServersInfo('Version')
  mySQLServersDataPaths = get_mysqlServersInfo('DataLocation')
  
  final_dependence.append(check_mysqlServer(mySQLServersBitness, mySQLServersVersions, mySQLServersPaths, mySQLServersDataPaths))
  
  return final_dependence
  
