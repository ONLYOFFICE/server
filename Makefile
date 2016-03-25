OUTPUT_DIR = build
OUTPUT = $(OUTPUT_DIR)

NODE_MODULES_DIR = node_modules
NODE_PROJECTS_SRC = Common DocService FileConverter Metrics SpellChecker
NODE_PROJECTS = $(addprefix $(OUTPUT)/, $(NODE_PROJECTS_SRC))
NODE_PROJECTS_MODULES = $(addsuffix /$(NODE_MODULES_DIR), $(NODE_PROJECTS))

FILE_CONVERTER = $(OUTPUT)/FileConverter/bin
FILE_CONVERTER_FILES += ../core/build/lib/linux_64/*.so
FILE_CONVERTER_FILES += ../core/build/lib/DoctRenderer.config
FILE_CONVERTER_FILES += ../core/build/bin/icu/linux_64/*.so*
FILE_CONVERTER_FILES += ../core/build/bin/linux/x2t
FILE_CONVERTER_FILES += ../core/build/bin/linux/icudtl_dat.S

HTML_FILE_INTERNAL := $(FILE_CONVERTER)/HtmlFileInternal
HTML_FILE_INTERNAL_FILES += ../core/build/lib/linux_64/HtmlFileInternal
HTML_FILE_INTERNAL_FILES += ../core/build/cef/linux64/**

SCHEMA_DIR = schema
SCHEMA_FILES = $(SCHEMA_DIR)/**
SCHEMA = $(OUTPUT)/$(SCHEMA_DIR)/

TOOLS_DIR = tools
TOOLS_FILES = ../core/build/bin/AllFontsGen/linux_64
TOOLS = $(OUTPUT)/$(TOOLS_DIR)/

LICENSE_FILES = LICENSE.txt 3rd-Party.txt
LICENSE = $(addsuffix $(OUTPUT)/, LICENSE_FILES)

all: $(NODE_PROJECTS_MODULES) $(FILE_CONVERTER) $(TOOLS) $(SCHEMA) $(LICENSE)

$(NODE_PROJECTS_MODULES): $(NODE_PROJECTS)
	cd $(@D) && \
		npm install
		
$(NODE_PROJECTS):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(NODE_PROJECTS_SRC)
		
$(FILE_CONVERTER): $(NODE_PROJECTS)
	mkdir -p $(FILE_CONVERTER) $(HTML_FILE_INTERNAL) && \
		cp -r -t $(FILE_CONVERTER) $(FILE_CONVERTER_FILES) && \
		cp -r -t $(HTML_FILE_INTERNAL) $(HTML_FILE_INTERNAL_FILES)

$(SCHEMA):
	mkdir -p $(SCHEMA) && \
		cp -r -t $(SCHEMA) $(SCHEMA_FILES)
		
$(TOOLS):
	mkdir -p $(TOOLS) && \
		cp -r -t $(TOOLS) $(TOOLS_FILES) && \
		mv $(TOOLS)/linux_64 $(TOOLS)/AllFontsGen
		
$(LICENSE):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(LICENSE_FILES)
	
clean:
	rm -rf $(OUTPUT)
	
