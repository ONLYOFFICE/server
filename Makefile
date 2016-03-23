OUTPUT_DIR = build
OUTPUT = $(OUTPUT_DIR)

NODE_MODULES_DIR = node_modules
NODE_PROJECTS_SRC = Common DocService FileConverter Metrics SpellChecker
NODE_PROJECTS = $(addprefix $(OUTPUT)/, $(NODE_PROJECTS_SRC))
NODE_PROJECTS_MODULES = $(addsuffix /$(NODE_MODULES_DIR), $(NODE_PROJECTS))

FILE_CONVERTER = $(OUTPUT)/$(NODE_PROJECTS_DIR)/FileConverter/Bin
FILE_CONVERTER_FILES = ServerComponents/Bin/**

SCHEMA_DIR = schema
SCHEMA_FILES = $(SCHEMA_DIR)/**
SCHEMA = $(OUTPUT)/$(SCHEMA_DIR)/

TOOLS_DIR = Tools
TOOLS_FILES = $(TOOLS_DIR)/Bin/**
TOOLS = $(OUTPUT)/$(TOOLS_DIR)/

LICENSE_FILES = LICENSE.txt 3rd-Party.txt
LICENSE = $(addsuffix $(OUTPUT)/, LICENSE_FILES)

all: $(NODE_PROJECTS_MODULES) $(SCHEMA) $(LICENSE)

$(NODE_PROJECTS_MODULES): $(NODE_PROJECTS)
	cd $(@D) && \
		npm install
		
$(NODE_PROJECTS):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(NODE_PROJECTS_SRC)
		
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
	
