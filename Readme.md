
# Server

[![License](https://img.shields.io/badge/License-GNU%20AGPL%20V3-green.svg?style=flat)](https://www.gnu.org/licenses/agpl-3.0.en.html)

The backend server software layer which is the part of [ONLYOFFICE Document Server][2] and is the base for all other components.

## Document service set up

This instruction describes document service deployment for Windows based platform.

### Installing necessary components

For the document service to work correctly it is necessary to install the following components for your Windows system (if not specified additionally, the latest version for 32 or 64 bit Windows can be installed with default settings):

1. [Git](https://git-scm.com/download/win)

2. [Node.js](https://nodejs.org/en/download/) version 8.0.0 or later

3. [Java](https://java.com/en/download/). Necessary for the sdk build.

4. Database (MySQL or PostgreSQL). When installing use the `onlyoffice` password for the `root` user.
    * [MySQL Server](http://dev.mysql.com/downloads/windows/installer/) version 5.5 or later

    * [PostgreSQL Server](https://www.postgresql.org/download/) version 9.1 or later

5. [Erlang](https://www.erlang.org/download.html)

6. [RabbitMQ](https://www.rabbitmq.com/download.html)

7. [Redis](https://github.com/microsoftarchive/redis/releases/latest)  
   *microsoftarchive version, official version is only for \*nix systems*

8. [Python 3.x](https://www.python.org/downloads/)

9. Microsoft Visual C++ Express 2010 (necessary for the spellchecker modules build)

### Setting up the system

1. Clone DocumentServer Project  
   `git clone --recursive https://github.com/ONLYOFFICE/DocumentServer/`

2. Database setup:

    * Database setup for MySQL  
      Run the `schema/mysql/createdb.sql` script for MySQL

    * Database setup for PostgreSQL  
        1. Enter in `psql` (PostgreSQL interactive terminal) with
           login and password introduced during installation, then enter commands:  

            ```sql
            CREATE DATABASE onlyoffice;
            CREATE USER onlyoffice WITH PASSWORD 'onlyoffice';
            \c onlyoffice
            \i 'schema/postgresql/createdb.sql';
            GRANT ALL PRIVILEGES ON DATABASE onlyoffice to onlyoffice;
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO onlyoffice;
            ```

        2. Delete from `server\Common\config\development-windows.json` option `sql`.

3. Install the Web Monitor for RabbitMQ (see the details for the installation [here](https://www.rabbitmq.com/management.html))
4. Open the command line `cmd` executable.
5. Switch to the installation directory using the `cd /d Installation-directory/sbin` command.
6. Run the following command:

    ```powershell
    rabbitmq-plugins.bat enable rabbitmq_management
    ```

7. The Web Monitor is located at the [http://localhost:15672/](http://localhost:15672/) address.
   Use the `guest:guest` for the login:password combination.

8. If Redis does not start or crashes after the start for some reason,
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

If you have any problems with or questions about [ONLYOFFICE Document Server][2], please visit our official forum to find answers to your questions: [dev.onlyoffice.org][1] or you can ask and answer ONLYOFFICE development questions on [Stack Overflow][3].

  [1]: http://dev.onlyoffice.org
  [2]: https://github.com/ONLYOFFICE/DocumentServer
  [3]: https://stackoverflow.com/questions/tagged/onlyoffice

## License

Server is released under an GNU AGPL v3.0 license. See the LICENSE file for more information.
