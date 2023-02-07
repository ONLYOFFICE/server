
# Server

[![License](https://img.shields.io/badge/License-GNU%20AGPL%20V3-green.svg?style=flat)](https://www.gnu.org/licenses/agpl-3.0.en.html)

The backend server software layer which is the part of [ONLYOFFICE Document Server][2] and [ONLYOFFICE Desktop Editors][4] and is the base for all other components.

## Document service set up

This instruction describes document service deployment for Windows based platform.

### Installing necessary components

For the document service to work correctly it is necessary to install the following components for your Windows system (if not specified additionally, the latest version for 32 or 64 bit Windows can be installed with default settings):

1. [Node.js](https://nodejs.org/en/download/) version 8.0.0 or later

2. [Java](https://java.com/en/download/). Necessary for the sdk build.

3. Database (MySQL or PostgreSQL). When installing use the `onlyoffice` password for the `root` user.
    * [MySQL Server](http://dev.mysql.com/downloads/windows/installer/) version 5.5 or later

    * [PostgreSQL Server](https://www.postgresql.org/download/) version 9.1 or later

4. [Erlang](https://www.erlang.org/download.html)

5. [RabbitMQ](https://www.rabbitmq.com/releases/rabbitmq-server/v3.5.4/rabbitmq-server-3.5.4.exe)

6. [Redis](https://github.com/microsoftarchive/redis/releases/latest)

7. [Python 2.7](https://www.python.org/downloads/release/python-2716/)

8. Microsoft Visual C++ Express 2010 (necessary for the spellchecker modules build)

### Setting up the system

1. Database setup:

    * Database setup for MySQL  
      Run the `schema/mysql/createdb.sql` script for MySQL

    * Database setup for PostgreSQL  
        1. Enter in `psql` (PostgreSQL interactive terminal) with
           login and password introduced during installation, then enter commands:  

            ```sql
            CREATE USER onlyoffice WITH PASSWORD 'onlyoffice';
            CREATE DATABASE onlyoffice OWNER onlyoffice;
            \c onlyoffice
            \i 'schema/postgresql/createdb.sql';
            ```

        2. Delete from `server\Common\config\development-windows.json` option `sql`.

2. Install the Web Monitor for RabbitMQ (see the details for the installation [here](https://www.rabbitmq.com/management.html))
3. Open the command line `cmd` executable.
4. Switch to the installation directory using the `cd /d Installation-directory/sbin` command.
5. Run the following command:

    ```powershell
    rabbitmq-plugins.bat enable rabbitmq_management
    ```

6. The Web Monitor is located at the [http://localhost:15672/](http://localhost:15672/) address.
   Use the `guest:guest` for the login:password combination.

7. If Redis does not start or crashes after the start for some reason,
   try to change the `maxheap` parameter in the config settings.
   For 64 bit version of Windows 7 the config file can be found here:
   `C:\Program Files\Redis\redis.windows-service.conf`.
   Find the `# maxheap <bytes>` line and change it to, e.g.

   ```config
   maxheap 128MB
   ```

   and restart the service

### Running the service

Run the `run.bat` script to start the service.

Notes

All config files for the server part can be found in the `Common\config` folder

* `default.json` - common config files similar for all production versions.
* `production-windows.json` - config files for the production version running on a Windows based platform.
* `production-linux.json` - config files for the production version running on a Linux based platform.
* `development-windows.json` - config files for the development version running on a Windows based platform (this configuration is used when running the 'run.bat' script).

In case it is necessary to temporarily edit the config files, create the local.json file and reassign the values there. It will allow to prevent from uploading local changes and losing config files when updating the repository. See [Configuration Files](https://github.com/lorenwest/node-config/wiki/Configuration-Files) for more information about the configuration files.

## User Feedback and Support

If you have any problems with or questions about [ONLYOFFICE Document Server][2], please visit our official forum to find answers to your questions: [forum.onlyoffice.com][1] or you can ask and answer ONLYOFFICE development questions on [Stack Overflow][3].

  [1]: https://forum.onlyoffice.com
  [2]: https://github.com/ONLYOFFICE/DocumentServer
  [3]: https://stackoverflow.com/questions/tagged/onlyoffice
  [4]: https://github.com/ONLYOFFICE/DesktopEditors

## License

Server is released under an GNU AGPL v3.0 license. See the LICENSE file for more information.
