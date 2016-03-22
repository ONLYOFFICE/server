GRUNT = grunt
GRUNT_FLAGS = --no-color -v

OUTPUT_DIR = deploy
OUTPUT = $(OUTPUT_DIR)

OFFICEWEB_DIR = OfficeWeb
OFFICEWEB = $(OUTPUT)/$(OFFICEWEB_DIR)
GRUNT_FILES = OfficeWeb/sdk/build/deploy/Gruntfile.js.out OfficeWeb/build/Gruntfile.js.out

NODE_PROJECTS_DIR = NodeJsProjects
NODE_MODULES_DIR = node_modules
NODE_PROJECTS_SRC = $(sort $(dir $(wildcard $(NODE_PROJECTS_DIR)/*/)))
NODE_PROJECTS = $(addprefix $(OUTPUT)/, $(NODE_PROJECTS_SRC))
NODE_PROJECTS_MODULES = $(addsuffix /$(NODE_MODULES_DIR), $(NODE_PROJECTS))

FILE_CONVERTER = $(OUTPUT)/$(NODE_PROJECTS_DIR)/FileConverter/Bin
FILE_CONVERTER_FILES = ServerComponents/Bin/**

SCHEMA_DIR = Schema
SCHEMA_FILES = $(SCHEMA_DIR)/**
SCHEMA = $(OUTPUT)/$(SCHEMA_DIR)/

TOOLS_DIR = Tools
TOOLS_FILES = $(TOOLS_DIR)/Bin/**
TOOLS = $(OUTPUT)/$(TOOLS_DIR)/

LICENSE_FILES = License.txt 3rd-Party.txt
LICENSE = $(addsuffix $(OUTPUT)/, LICENSE_SRC)

all: $(NODE_PROJECTS_MODULES) $(OFFICEWEB) $(FILE_CONVERTER) $(SCHEMA) $(TOOLS) $(LICENSE)

$(OFFICEWEB): $(GRUNT_FILES)
	mkdir -p $(OUTPUT)/$(OFFICEWEB_DIR) && \
		cp -r -t $(OUTPUT)/$(OFFICEWEB_DIR) $(OFFICEWEB_DIR)/deploy/** 

$(GRUNT_FILES):
	cd $(@D) && \
		npm install && \
		$(GRUNT) $(GRUNT_FLAGS)
	echo "Done" > $@

$(NODE_PROJECTS_MODULES): $(NODE_PROJECTS)
	cd $(@D) && \
		npm install
		
$(NODE_PROJECTS):
	mkdir -p $(OUTPUT)/$(NODE_PROJECTS_DIR) && \
		cp -r -t $(OUTPUT)/$(NODE_PROJECTS_DIR) $(NODE_PROJECTS_SRC)
		
$(FILE_CONVERTER): $(NODE_PROJECTS)
	mkdir -p $(FILE_CONVERTER) && \
		cp -r -t $(FILE_CONVERTER) $(FILE_CONVERTER_FILES)

$(SCHEMA):
	mkdir -p $(SCHEMA) && \
		cp -r -t $(SCHEMA) $(SCHEMA_FILES)
		
$(TOOLS):
	mkdir -p $(TOOLS) && \
		cp -r -t $(TOOLS) $(TOOLS_FILES)
		
$(LICENSE):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(LICENSE_FILES)
	
clean:
	rm -rf $(OUTPUT)
	rm -f $(GRUNT_FILES)

install:
	sudo adduser --quiet --home /var/www/onlyoffice --system --group onlyoffice

	sudo mkdir -p /var/log/onlyoffice
	sudo mkdir -p /var/lib/onlyoffice/documentserver/App_Data

	sudo chown onlyoffice:onlyoffice -R /var/www/onlyoffice
	sudo chown onlyoffice:onlyoffice -R /var/log/onlyoffice
	sudo chown onlyoffice:onlyoffice -R /var/lib/onlyoffice

	sudo cp -r deploy/. /var/www/onlyoffice/documentserver/
	sudo cp -r OnlineEditorsExample/. /var/www/onlyoffice/documentserver/OnlineEditorsExample/


	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libDjVuFile.so /lib/libDjVuFile.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libdoctrenderer.so /lib/libdoctrenderer.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libHtmlFile.so /lib/libHtmlFile.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libHtmlRenderer.so /lib/libHtmlRenderer.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libPdfReader.so /lib/libPdfReader.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libPdfWriter.so /lib/libPdfWriter.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libXpsFile.so /lib/libXpsFile.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libUnicodeConverter.so /lib/libUnicodeConverter.so
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libicudata.so.55 /lib/libicudata.so.55
	sudo ln -s /var/www/onlyoffice/documentserver/NodeJsProjects/FileConverter/Bin/libicuuc.so.55 /lib/libicuuc.so.55

	sudo -u onlyoffice /var/www/onlyoffice/documentserver/Tools/GenerateAllFonts.sh

uninstall:
	sudo userdel onlyoffice
	
	sudo unlink /lib/libDjVuFile.so
	sudo unlink /lib/libdoctrenderer.so
	sudo unlink /lib/libHtmlFile.so
	sudo unlink /lib/libHtmlRenderer.so
	sudo unlink /lib/libPdfReader.so
	sudo unlink /lib/libPdfWriter.so
	sudo unlink /lib/libXpsFile.so
	sudo unlink /lib/libUnicodeConverter.so
	sudo unlink /lib/libicudata.so.55
	sudo unlink /lib/libicuuc.so.55

	sudo rm -rf /var/www/onlyoffice/documentserver
	sudo rm -rf /var/log/onlyoffice/documentserver
	sudo rm -rf /var/lib/onlyoffice/documentserver
	
