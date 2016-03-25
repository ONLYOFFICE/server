#!/bin/bash

echo "----------------------------------------"
echo "Copy file to converter"
echo "----------------------------------------"

BASEDIR=$(pwd)

echo "$BASEDIR"

CreateDir() {
    if [ ! -d $1 ]; then
        mkdir -pv $1;
    fi
}

NpmInstall() {
    cd $1
    echo "Module path: $(pwd)"
    npm install
}

RunCommand() {
    osascript -e 'tell application "terminal"' -e "do script \"$1\"" -e 'end tell'
}

CreateDir "$BASEDIR/App_Data"
CreateDir "$BASEDIR/FileConverter/Bin"
CreateDir "$BASEDIR/FileConverter/Bin/HtmlFileInternal"

cd "$BASEDIR/FileConverter/Bin"

cp -v "../../../core/build/bin/mac/icudtl_dat.S" "."
cp -v "../../../core/build/bin/mac/x2t" "."
cp -v "../../../core/build/bin/icu/mac_64/libicudata.55.1.dylib" "."
cp -v "../../../core/build/bin/icu/mac_64/libicuuc.55.1.dylib" "."
cp -v "../../../core/build/lib/mac_64/libDjVuFile.dylib" "."
cp -v "../../../core/build/lib/mac_64/libHtmlFile.dylib" "."
cp -v "../../../core/build/lib/mac_64/libHtmlRenderer.dylib" "."
cp -v "../../../core/build/lib/mac_64/libPdfReader.dylib" "."
cp -v "../../../core/build/lib/mac_64/libPdfWriter.dylib" "."
cp -v "../../../core/build/lib/mac_64/libUnicodeConverter.dylib" "."
cp -v "../../../core/build/lib/mac_64/libXpsFile.dylib" "."
cp -v "../../../core/build/lib/mac_64/libascdocumentscore.dylib" "."
cp -v "../../../core/build/lib/mac_64/libdoctrenderer.dylib" "."

ln -siv libicuuc.55.1.dylib libicuuc.55.dylib
ln -siv libicudata.55.1.dylib libicudata.55.dylib
chmod -v +x x2t

SEARCH='..\/..\/OfficeWeb'
REPLACE='..\/..\/..\/sdkjs'
sed "s/$SEARCH/$REPLACE/g" "../../../core/build/lib/DoctRenderer.config" > "DoctRenderer.config"

echo $BASEDIR
chmod -v +x $BASEDIR/../core/build/bin/AllFontsGen/mac_64
bash -cv "$BASEDIR/../core/build/bin/AllFontsGen/mac_64 '' '$BASEDIR/../sdkjs/Common/AllFonts.js' '$BASEDIR/../sdkjs/Common/Images' '$BASEDIR/FileConverter/Bin/font_selection.bin'"


echo "----------------------------------------"
echo "Install node.js modules "
echo "----------------------------------------"

NpmInstall "$BASEDIR/DocService"
NpmInstall "$BASEDIR/Common"
NpmInstall "$BASEDIR/FileConverter"
NpmInstall "$BASEDIR/SpellChecker"



echo "----------------------------------------"
echo "Run services"
echo "----------------------------------------"

mysql.server restart
RunCommand "/usr/local/sbin/rabbitmq-server"
RunCommand "redis-server /usr/local/etc/redis.conf"

RunCommand "export NODE_CONFIG_DIR=$BASEDIR/Common/config && export NODE_ENV=development-mac && cd $BASEDIR/DocService/sources && node server.js"
RunCommand "export NODE_CONFIG_DIR=$BASEDIR/Common/config && export NODE_ENV=development-mac && cd $BASEDIR/DocService/sources && node gc.js"
RunCommand "export NODE_CONFIG_DIR=$BASEDIR/Common/config && export NODE_ENV=development-mac && cd $BASEDIR/FileConverter/sources && node convertermaster.js"


