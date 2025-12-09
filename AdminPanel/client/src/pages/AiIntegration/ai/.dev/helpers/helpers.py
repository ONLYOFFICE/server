import os
import glob

content_license = ""
editors = {
    "word": [],
    "slide": [],
    "cell": []
}

for editor in editors:
    files = glob.glob("./" + editor + "/**/*.js", recursive=True)
    for file in files:
        with open(file, 'r', encoding='utf-8') as f:
            file_content = f.read()
            if file_content.startswith("/*"):
                end_license = file_content.find("*/") + 2
                if content_license == "":
                    content_license = file_content[:end_license]
                file_content = file_content[end_license:].strip()
            editors[editor].append(file_content)

content = "var HELPERS = {};\n\n"
for editor in editors:
    content += "HELPERS." + editor + " = [];\n"
    for h in editors[editor]:
        if h.endswith(";"):
            h = h[:-1]
        content += "HELPERS." + editor + ".push(" + h + ");\n"

    content += "\n\n"

content = content_license + "\n\n" + content
with open("./../../scripts/helpers/helpers.js", 'w', encoding='utf-8') as f:
    f.write(content)
