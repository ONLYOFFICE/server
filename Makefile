OUTPUT_DIR = build/server
OUTPUT = $(OUTPUT_DIR)

GRUNT = grunt
GRUNT_FLAGS = --no-color -v 

GRUNT_FILES = Gruntfile.js.out

PRODUCT_VERSION ?= 0.0.0
BUILD_NUMBER ?= 0

DOCUMENT_ROOT = /var/www/onlyoffice/documentserver
LOG_DIR = /var/log/onlyoffice/documentserver
DATA_DIR = /var/lib/onlyoffice/documentserver/App_Data
CONFIG_DIR = /etc/onlyoffice/documentserver
CREATE_USER = TRUE

ifeq ($(OS),Windows_NT)
    PLATFORM := win
    EXEC_EXT := .exe
    SHARED_EXT := .dll
    ifeq ($(PROCESSOR_ARCHITECTURE),AMD64)
        ARCHITECTURE := 64
    endif
    ifeq ($(PROCESSOR_ARCHITECTURE),x86)
        ARCHITECTURE := 32
    endif
else
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Linux)
        PLATFORM := linux
        SHARED_EXT := .so*
    endif
    UNAME_M := $(shell uname -m)
    ifeq ($(UNAME_M),x86_64)
        ARCHITECTURE := 64
    endif
    ifneq ($(filter %86,$(UNAME_M)),)
        ARCHITECTURE := 32
    endif
endif

TARGET := $(PLATFORM)_$(ARCHITECTURE)

FILE_CONVERTER = $(OUTPUT)/FileConverter/bin
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/*$(SHARED_EXT)

ifeq ($(PLATFORM),linux)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/libicudata$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/libicuuc$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/v8/$(TARGET)/icudtl_dat.S
endif

ifeq ($(PLATFORM),win)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/icudt55$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/icuuc55$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/v8/$(TARGET)/release/icudt.dll
endif

FILE_CONVERTER_FILES += ../core/build/bin/$(TARGET)/x2t$(EXEC_EXT)

DOC_BUILDER_FILES += ../core/build/bin/$(TARGET)/docbuilder$(EXEC_EXT)
DOC_BUILDER_FILES += ../core/Common/empty

HTML_FILE_INTERNAL := $(FILE_CONVERTER)/HtmlFileInternal
HTML_FILE_INTERNAL_FILES += ../core/build/lib/$(TARGET)/HtmlFileInternal$(EXEC_EXT)
HTML_FILE_INTERNAL_FILES += ../core/Common/3dParty/cef/$(TARGET)/build/**

SPELLCHECKER_DICTIONARIES := $(OUTPUT)/SpellChecker/dictionaries
SPELLCHECKER_DICTIONARY_FILES += ../dictionaries/**

SCHEMA_DIR = schema
SCHEMA_FILES = $(SCHEMA_DIR)/**
SCHEMA = $(OUTPUT)/$(SCHEMA_DIR)/

TOOLS_DIR = tools
TOOLS_FILES = ../core/build/bin/AllFontsGen/$(TARGET)
TOOLS = $(OUTPUT)/$(TOOLS_DIR)

LICENSE_FILES = LICENSE.txt 3rd-Party.txt license/
LICENSE = $(addsuffix $(OUTPUT)/, LICENSE_FILES)

LICENSE_JS := $(OUTPUT)/Common/sources/license.js
COMMON_DEFINES_JS := $(OUTPUT)/Common/sources/commondefines.js

WELCOME_DIR = welcome
WELCOME_FILES = $(WELCOME_DIR)/**
WELCOME = $(OUTPUT)/$(WELCOME_DIR)/

.PHONY: all clean install uninstall build-date htmlfileinternal docbuilder

.NOTPARALLEL:
all: $(FILE_CONVERTER) $(SPELLCHECKER_DICTIONARIES) $(TOOLS) $(SCHEMA) $(LICENSE) $(WELCOME) build-date

ext: htmlfileinternal docbuilder

build-date: $(GRUNT_FILES)
	sed "s|\(const buildVersion = \).*|\1'${PRODUCT_VERSION}';|" -i $(COMMON_DEFINES_JS)
	sed "s|\(const buildNumber = \).*|\1${BUILD_NUMBER};|" -i $(COMMON_DEFINES_JS)
	sed "s|\(const buildDate = \).*|\1'$$(date +%F)';|" -i $(LICENSE_JS)
	
htmlfileinternal: $(FILE_CONVERTER)
	mkdir -p $(HTML_FILE_INTERNAL) && \
		cp -r -t $(HTML_FILE_INTERNAL) $(HTML_FILE_INTERNAL_FILES)

docbuilder: $(FILE_CONVERTER)
	cp -r -t $(FILE_CONVERTER) $(DOC_BUILDER_FILES)

$(FILE_CONVERTER): $(GRUNT_FILES)
	mkdir -p $(FILE_CONVERTER) && \
		cp -r -t $(FILE_CONVERTER) $(FILE_CONVERTER_FILES)

$(SPELLCHECKER_DICTIONARIES): $(GRUNT_FILES)
	mkdir -p $(SPELLCHECKER_DICTIONARIES) && \
		cp -r -t $(SPELLCHECKER_DICTIONARIES) $(SPELLCHECKER_DICTIONARY_FILES)

$(SCHEMA):
	mkdir -p $(SCHEMA) && \
		cp -r -t $(SCHEMA) $(SCHEMA_FILES)
		
$(TOOLS):
	mkdir -p $(TOOLS) && \
		cp -r -t $(TOOLS) $(TOOLS_FILES) && \
		mv $(TOOLS)/$(TARGET)$(EXEC_EXT) $(TOOLS)/AllFontsGen$(EXEC_EXT)
		
$(LICENSE):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(LICENSE_FILES)
		
$(GRUNT_FILES):
	cd $(@D) && \
		npm install && \
		$(GRUNT) $(GRUNT_FLAGS)
	echo "Done" > $@

$(WELCOME):
	mkdir -p $(WELCOME) && \
		cp -r -t $(WELCOME) $(WELCOME_FILES)

clean:
	rm -rf $(OUTPUT) $(GRUNT_FILES)

install:
	mkdir -p ${DESTDIR}${DOCUMENT_ROOT}
	mkdir -p ${DESTDIR}${LOG_DIR}
	mkdir -p ${DESTDIR}${DATA_DIR}
	
	cp -fr -t ${DESTDIR}${DOCUMENT_ROOT} build/* ../web-apps/deploy/*
	mkdir -p ${DESTDIR}${CONFIG_DIR}
	mv ${DESTDIR}${DOCUMENT_ROOT}/server/Common/config/* ${DESTDIR}${CONFIG_DIR}
	

ifeq ($(CREATE_USER),TRUE)
	adduser --quiet --home ${DESTDIR}${DOCUMENT_ROOT} --system --group onlyoffice
	chown onlyoffice:onlyoffice -R ${DESTDIR}$(dirname {DOCUMENT_ROOT})
	chown onlyoffice:onlyoffice -R ${DESTDIR}$(dirname {LOG_DIR})
	chown onlyoffice:onlyoffice -R ${DESTDIR}$(dirname $(dirname {DATA_DIR}))
endif

	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libDjVuFile.so ${DESTDIR}/lib/libDjVuFile.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libdoctrenderer.so ${DESTDIR}/lib/libdoctrenderer.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libHtmlFile.so ${DESTDIR}/lib/libHtmlFile.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libHtmlRenderer.so ${DESTDIR}/lib/libHtmlRenderer.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libPdfReader.so ${DESTDIR}/lib/libPdfReader.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libPdfWriter.so ${DESTDIR}/lib/libPdfWriter.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libXpsFile.so ${DESTDIR}/lib/libXpsFile.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libUnicodeConverter.so ${DESTDIR}/lib/libUnicodeConverter.so
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libicudata.so.55 ${DESTDIR}/lib/libicudata.so.55
	ln -s ${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/libicuuc.so.55 ${DESTDIR}/lib/libicuuc.so.55

ifeq ($(CREATE_USER),TRUE)
	sudo -u onlyoffice "${DESTDIR}${DOCUMENT_ROOT}/server/tools/AllFontsGen"\
		"/usr/share/fonts"\
		"${DESTDIR}${DOCUMENT_ROOT}/sdkjs/common/AllFonts.js"\
		"${DESTDIR}${DOCUMENT_ROOT}/sdkjs/common/Images"\
		"${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/font_selection.bin"
endif

uninstall:
ifeq ($(CREATE_USER),TRUE)
	sudo -u onlyoffice "${DESTDIR}${DOCUMENT_ROOT}/server/tools/AllFontsGen"\
	userdel onlyoffice # FIXME
endif
	
	unlink ${DESTDIR}/lib/libDjVuFile.so
	unlink ${DESTDIR}/lib/libdoctrenderer.so
	unlink ${DESTDIR}/lib/libHtmlFile.so
	unlink ${DESTDIR}/lib/libHtmlRenderer.so
	unlink ${DESTDIR}/lib/libPdfReader.so
	unlink ${DESTDIR}/lib/libPdfWriter.so
	unlink ${DESTDIR}/lib/libXpsFile.so
	unlink ${DESTDIR}/lib/libUnicodeConverter.so
	unlink ${DESTDIR}/lib/libicudata.so.55
	unlink ${DESTDIR}/lib/libicuuc.so.55

	rm -rf ${DESTDIR}${DOCUMENT_ROOT}
	rm -rf ${DESTDIR}${LOG_DIR}
	rm -rf ${DESTDIR}$(dirname {DATA_DIR})
	rm -rf ${DESTDIR}${CONFIG_DIR}
