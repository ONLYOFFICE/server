/*
 * (c) Copyright Ascensio System SIA 2010-2025
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

function getSlideFunctions() {
	let funcs = [];

	if (true) {
		let func = new RegisteredFunction();
		func.name = "addNewSlide";
		func.description = "Adds a new slide at the end of presentation using default layout from current slide's master";
		func.params = [];
		func.examples = ["if you need to add a new slide, respond with:\n" + "[functionCalling (addNewSlide)]: {}"];

		func.call = async function (params) {
			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let currentSlide = presentation.GetCurrentSlide();
				let master;
				if (currentSlide) {
					currentSlide = presentation.GetSlideByIndex(0);
					let curLayout = currentSlide.GetLayout();
					master = curLayout.GetMaster();
				}
				else {
					master = presentation.GetMasterByIndex(0);
				}
				if (!master) {
					return;
				}

				let layout = master.GetLayoutByType("obj");
				if (!layout) {
					let layoutsCount = master.GetLayoutsCount();
					if (layoutsCount > 0) {
						layout = master.GetLayout(0);
					}
				}

				if (!layout) return;
				let newSlide = Api.CreateSlide();

				if (layout) {
					newSlide.ApplyLayout(layout);
				}

				presentation.AddSlide(newSlide);
			});
		};
		funcs.push(func);
	}

	if (true) {
		let func = new RegisteredFunction();
		func.name = "addShapeToSlide";
		func.description = "Adds a shape to the slide with optional text (139x42mm, centered, blue fill with dark border)";
		func.params = [
			"slideNumber (number): slide number to add shape to (optional, defaults to current)", 
			"shapeType (string): shape type - rect, roundRect, ellipse, triangle, diamond, pentagon, hexagon, star5, plus, mathMinus, mathMultiply, mathEqual, mathNotEqual, heart, cloud, leftArrow, rightArrow, upArrow, downArrow, leftRightArrow, chevron, bentArrow, curvedRightArrow, blockArc, wedgeRectCallout, cloudCallout, ribbon, wave, can, cube, pie, donut, sun, moon, smileyFace, lightningBolt, noSmoking (optional, defaults to roundRect)", 
			"text (string): text to add to the shape (optional)"];
		func.examples = [
			"if you need to add a rectangle with text on slide 2, respond with:\n" + 
			"[functionCalling (addShapeToSlide)]: {\"slideNumber\": 2, \"shapeType\": \"rect\", \"text\": \"Important Point\"}", 
			"if you need to add a star shape on current slide, respond with:\n" + 
			"[functionCalling (addShapeToSlide)]: {\"shapeType\": \"star5\"}", 
			"if you need to add a rounded rectangle with text, respond with:\n" + 
			"[functionCalling (addShapeToSlide)]: {\"text\": \"Key Message\"}", 
			"if you need to add a diamond shape with text, respond with:\n" + 
			"[functionCalling (addShapeToSlide)]: {\"shapeType\": \"diamond\", \"text\": \"Decision Point\"}", 
			"if you need to add a right arrow with text, respond with:\n" + 
			"[functionCalling (addShapeToSlide)]: {\"shapeType\": \"rightArrow\", \"text\": \"Next Step\"}"
		];

		func.call = async function (params) {
			Asc.scope.params = params;

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide;

				if (Asc.scope.params.slideNumber) {
					slide = presentation.GetSlideByIndex(Asc.scope.params.slideNumber - 1);
				}
				else {
					slide = presentation.GetCurrentSlide();
				}

				if (!slide) return;

				let slideWidth = presentation.GetWidth();
				let slideHeight = presentation.GetHeight();

				let shapeType = Asc.scope.params.shapeType || "rect";
				let width = 2500000;
				let height = 2500000;
				let x = (slideWidth - width) / 2;
				let y = (slideHeight - height) / 2;

				let fill = Api.CreateSolidFill(Api.CreateSchemeColor("accent1"));
				let stroke = Api.CreateStroke(12700, Api.CreateSolidFill(Api.CreateRGBColor(51, 51, 51)));

				let shape = Api.CreateShape(shapeType, width, height, fill, stroke);
				shape.SetPosition(x, y);

				if (Asc.scope.params.text) {
					let docContent = shape.GetDocContent();
					if (docContent) {
						let paragraph = docContent.GetElement(0);
						if (!paragraph) {
							paragraph = Api.CreateParagraph();
							docContent.Push(paragraph);
						}
						paragraph.SetJc("center");
						paragraph.AddText(Asc.scope.params.text);
						shape.SetVerticalTextAlign("center");
					}
				}
				slide.AddObject(shape);
			});
		};
		funcs.push(func);
	}

	if (true) {
		let func = new RegisteredFunction();
		func.name = "changeSlideBackground";
		func.params = [
			"slideNumber (number): the slide number to change background", 
			"backgroundType (string): type of background - 'solid', 'gradient'", 
			"color (string): hex color for solid background (e.g., '#FF5733')", 
			"gradientColors (array): array of hex colors for gradient"
		];
		func.examples = [
			"if you need to set blue background on slide 1, respond with:\n" + 
			"[functionCalling (changeSlideBackground)]: {\"slideNumber\": 1, \"backgroundType\": \"solid\", \"color\": \"#0066CC\"}", 
			"if you need to set gradient background, respond with:\n" + 
			"[functionCalling (changeSlideBackground)]: {\"slideNumber\": 2, \"backgroundType\": \"gradient\", \"gradientColors\": [\"#FF0000\", \"#0000FF\"]}"
		];

		func.call = async function (params) {
			Asc.scope.params = params;

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide = presentation.GetSlideByIndex(Asc.scope.params.slideNumber - 1);
				if (!slide) return;

				let fill;

				switch (Asc.scope.params.backgroundType) {
					case "solid":
						if (Asc.scope.params.color) {
							let rgb = parseInt(Asc.scope.params.color.slice(1), 16);
							let r = (rgb >> 16) & 255;
							let g = (rgb >> 8) & 255;
							let b = rgb & 255;
							fill = Api.CreateSolidFill(Api.CreateRGBColor(r, g, b));
						}
						break;

					case "gradient":
						if (Asc.scope.params.gradientColors && Asc.scope.params.gradientColors.length >= 2) {
							let stops = [];
							let step = 100000 / (Asc.scope.params.gradientColors.length - 1);

							for (let i = 0; i < Asc.scope.params.gradientColors.length; i++) {
								let color = Asc.scope.params.gradientColors[i];
								let rgb = parseInt(color.slice(1), 16);
								let r = (rgb >> 16) & 255;
								let g = (rgb >> 8) & 255;
								let b = rgb & 255;
								let stop = Api.CreateGradientStop(Api.CreateRGBColor(r, g, b), i * step);
								stops.push(stop);
							}

							fill = Api.CreateLinearGradientFill(stops, 5400000);
						}
						break;
				}

				if (fill) {
					slide.SetBackground(fill);
				}
			});
		};
		funcs.push(func);
	}

	if (true) {
		let func = new RegisteredFunction();
		func.name = "addImageByDescription";
		func.params = [
			"slideNumber (number): the slide number to add generated image to (optional, defaults to current)", 
			"description (string): text description of the image to generate", 
			"width (number, optional): image width in mm (default: 100)", 
			"height (number, optional): image height in mm (default: 100)", 
			"style (string, optional): image style (realistic, cartoon, abstract, etc.)"];
		func.examples = [
			"if you need to add an image of a sunset over mountains to slide 1, respond with:\n" + 
			"[functionCalling (addImageByDescription)]: {\"slideNumber\": 1, \"description\": \"beautiful sunset over mountain range with orange and purple sky\"}", 
			"if you need to add a cartoon style image of office workers with custom size, respond with:\n" + 
			"[functionCalling (addImageByDescription)]: {\"slideNumber\": 2, \"description\": \"team of diverse office workers collaborating around a table\", \"style\": \"cartoon\", \"width\": 180, \"height\": 120}"
		];

		func.call = async function (params) {


			Asc.scope.description = params.description;

			let widthMm = params.width || 100;
			let heightMm = params.height || 100;
			Asc.scope.width = widthMm * 36000;
			Asc.scope.height = heightMm * 36000;
			Asc.scope.style = params.style || "realistic";

			let widthPx = Math.round((widthMm / 25.4) * 96);
			let heightPx = Math.round((heightMm / 25.4) * 96);

			let requestEngine = null;
			requestEngine = AI.Request.create(AI.ActionType.ImageGeneration);
			if (!requestEngine) {
				return;
			}

			let fullPrompt = Asc.scope.description;
			if (Asc.scope.style && Asc.scope.style !== "realistic") {
				fullPrompt = Asc.scope.style + " style, " + fullPrompt;
			}

			fullPrompt += ", image size " + widthPx + "x" + heightPx + " pixels";

			let aspectRatio = widthPx / heightPx;
			if (aspectRatio > 1.8) {
				fullPrompt += ", wide panoramic format";
			}
			else if (aspectRatio < 0.6) {
				fullPrompt += ", tall vertical format";
			}
			else if (aspectRatio > 0.9 && aspectRatio < 1.1) {
				fullPrompt += ", square format";
			}

			let isSendedEndLongAction = false;

			async function checkEndAction() {
				if (!isSendedEndLongAction) {
					let actionName = "AI (" + requestEngine.modelUI.name + ")";
					await Asc.Editor.callMethod("EndAction", ["Block", actionName]);
					isSendedEndLongAction = true;
				}
			}

			let actionName = "AI (" + requestEngine.modelUI.name + ")";
			await Asc.Editor.callMethod("StartAction", ["Block", actionName]);
			await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

			try {
				let imageUrl;
				imageUrl = await requestEngine.imageGenerationRequest(fullPrompt);

				await checkEndAction();

				if (imageUrl) {
					Asc.scope.imageUrl = imageUrl;
					await Asc.Editor.callCommand(function () {
						let oPresentation = Api.GetPresentation();
						let oSlide;
						if (params.slideNumber !== undefined && params.slideNumber !== null) {
							oSlide = oPresentation.GetSlideByIndex(params.slideNum - 1);
						}
						else {
							oSlide = oPresentation.GetCurrentSlide();
						}
						if (!oSlide) return;

						let slideWidth = oPresentation.GetWidth();
						let slideHeight = oPresentation.GetHeight();

						let x = (slideWidth - Asc.scope.width) / 2;
						let y = (slideHeight - Asc.scope.height) / 2;

						let oImage = Api.CreateImage(Asc.scope.imageUrl, Asc.scope.width, Asc.scope.height);
						oImage.SetPosition(x, y);
						oSlide.AddObject(oImage);
					});
				}
			} catch (error) {
				await checkEndAction();
			}

			await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
		};
		funcs.push(func);
	}

	if (true) {
		let func = new RegisteredFunction();
		func.name = "addTableToSlide";
		func.description = "Adds a table to the slide (194x97mm, centered)";
		func.params = [
			"slideNumber (number): slide number to add table to (optional, defaults to current)", 
			"rows (number): number of rows (optional, defaults to 3)", 
			"columns (number): number of columns (optional, defaults to 3)", 
			"data (array): 2D array of cell values - rows x columns (optional)"
		];
		func.examples = [
			"if you need to add a 3x3 table on slide 2, respond with:\n" + 
			"[functionCalling (addTableToSlide)]: {\"slideNumber\": 2, \"rows\": 3, \"columns\": 3}", 
			"if you need to add a table with data on current slide, respond with:\n" + 
			"[functionCalling (addTableToSlide)]: {\"data\": [[\"Name\", \"Age\", \"City\"], [\"John\", \"30\", \"New York\"], [\"Jane\", \"25\", \"London\"]]}", 
			"if you need to add a simple 2x4 table, respond with:\n" + 
			"[functionCalling (addTableToSlide)]: {\"rows\": 2, \"columns\": 4}"
		];

		func.call = async function (params) {
			Asc.scope.params = params;

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide;

				if (Asc.scope.params.slideNumber) {
					slide = presentation.GetSlideByIndex(Asc.scope.params.slideNumber - 1);
				}
				else {
					slide = presentation.GetCurrentSlide();
				}

				if (!slide) return;

				let slideWidth = presentation.GetWidth();
				let slideHeight = presentation.GetHeight();

				let data = Asc.scope.params.data;
				let rows = Asc.scope.params.rows || 3;
				let columns = Asc.scope.params.columns || 3;

				if (data && Array.isArray(data) && data.length > 0) {
					rows = data.length;
					if (data[0] && Array.isArray(data[0])) {
						columns = data[0].length;
					}
				}

				let tableWidth = 7000000;
				let tableHeight = 3500000;
				let x = (slideWidth - tableWidth) / 2;
				let y = (slideHeight - tableHeight) / 2;

				let table = Api.CreateTable(columns, rows);

				if (table) {
					table.SetPosition(x, y);
					table.SetSize(tableWidth, tableHeight);
					let rowHeight = tableHeight / rows;
					if (data && Array.isArray(data)) {
						let rowCount = Math.min(data.length, rows);
						for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
							let row = table.GetRow(rowIdx);
							if (Array.isArray(data[rowIdx])) {
								let cellCount = Math.min(data[rowIdx].length, columns);
								for (let col = 0; col < cellCount; col++) {
									let cell = row.GetCell(col);
									if (cell) {
										let cellContent = cell.GetContent();
										if (cellContent) {
											cellContent.RemoveAllElements();
											let paragraph = Api.CreateParagraph();
											let value = data[rowIdx][col];
											if (value !== null && value !== undefined) {
												paragraph.AddText(value);
												cellContent.Push(paragraph);
											}
										}
									}
								}
							}
						}
					}

					slide.AddObject(table);
				}
			});
		};
		funcs.push(func);
	}

	if (true) {
		let func = new RegisteredFunction();
		func.name = "deleteSlide";
		func.params = [
			"slideNumber (number): the slide number to delete"
		];
		func.examples = [
			"if you need to delete slide 5, respond with:\n" + "[functionCalling (deleteSlide)]: {\"slideNumber\": 5}"
		];

		func.call = async function (params) {
			Asc.scope.slideNum = params.slideNumber;

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide = presentation.GetSlideByIndex(Asc.scope.slideNum - 1);
				if (slide) {
					slide.Delete();
				}
			});
		};
		funcs.push(func);
	}

	if (true) {
		let func = new RegisteredFunction();
		func.name = "duplicateSlide";
		func.params = [
			"slideNumber (number): the slide number to duplicate"
		];
		func.examples = [
			"if you need to duplicate slide 3, respond with:\n" + 
			"[functionCalling (duplicateSlide)]: {\"slideNumber\": 3}"
		];

		func.call = async function (params) {
			Asc.scope.slideNum = params.slideNumber;

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide = presentation.GetSlideByIndex(Asc.scope.slideNum - 1);
				if (slide) {
					let newSlide = slide.Duplicate(Asc.scope.slideNum);
				}
			});
		};
		funcs.push(func);
	}
	if (true) {
		let func = new RegisteredFunction();
		func.name = "addChartToSlide";
		func.description = "Adds a chart to the slide (152x89mm, centered)";
		func.params = [
			"slideNumber (number): slide number to add chart to (optional, defaults to current)", 
			"chartType (string): type of chart - bar, barStacked, barStackedPercent, bar3D, barStacked3D, barStackedPercent3D, barStackedPercent3DPerspective, horizontalBar, horizontalBarStacked, horizontalBarStackedPercent, horizontalBar3D, horizontalBarStacked3D, horizontalBarStackedPercent3D, lineNormal, lineStacked, lineStackedPercent, line3D, pie, pie3D, doughnut, scatter, stock, area, areaStacked, areaStackedPercent",
			"data (array): 2D array of numeric data values - all sub-arrays must have same length, number of arrays must match series count", 
			"series (array): array of series names - must have same length as data arrays count", 
			"categories (array): array of category names - must have same length as each data array", 
			"prompt (string): description of what kind of data to generate for the chart (optional)"
		];
		func.examples = [
			"if you need to add a bar chart showing sales data on slide 2, respond with:\n" + 
			"[functionCalling (addChartToSlide)]: {\"slideNumber\": 2, \"chartType\": \"bar3D\", \"data\": [[100, 120, 140], [90, 110, 130]], \"series\": [\"Product A\", \"Product B\"], \"categories\": [\"Q1\", \"Q2\", \"Q3\"]}", 
			"if you need to add a pie chart on current slide, respond with:\n" + 
			"[functionCalling (addChartToSlide)]: {\"chartType\": \"pie\", \"data\": [[30, 25, 20, 15, 10]], \"series\": [\"Market Share\"], \"categories\": [\"Company A\", \"Company B\", \"Company C\", \"Company D\", \"Others\"]}", 
			"if you need to add a line chart with 3 series and 4 data points, respond with:\n" + 
			"[functionCalling (addChartToSlide)]: {\"chartType\": \"lineNormal\", \"data\": [[10, 20, 30, 40], [15, 25, 35, 45], [12, 22, 32, 42]], \"series\": [\"Series 1\", \"Series 2\", \"Series 3\"], \"categories\": [\"Jan\", \"Feb\", \"Mar\", \"Apr\"]}", 
			"if you need AI to generate chart data, respond with:\n" + 
			"[functionCalling (addChartToSlide)]: {\"slideNumber\": 3, \"chartType\": \"lineNormal\", \"prompt\": \"Create monthly revenue data for 2024 showing steady growth from $50k to $120k\"}"
		];

		func.call = async function (params) {
			Asc.scope.params = params;

			if (params.prompt && !params.data) {
				let requestEngine = AI.Request.create(AI.ActionType.Chat);
				if (!requestEngine) return;

				let isSendedEndLongAction = false;

				async function checkEndAction() {
					if (!isSendedEndLongAction) {
						let actionName = "AI" + (requestEngine.modelUI && requestEngine.modelUI.name ? " (" + requestEngine.modelUI.name + ")" : " (Chart Generation)");
						await Asc.Editor.callMethod("EndAction", ["Block", actionName]);
						isSendedEndLongAction = true;
					}
				}

				let actionName = "AI" + (requestEngine.modelUI && requestEngine.modelUI.name ? " (" + requestEngine.modelUI.name + ")" : " (Chart Generation)");
				await Asc.Editor.callMethod("StartAction", ["Block", actionName]);
				await Asc.Editor.callMethod("StartAction", ["GroupActions"]);

				try {
					let chartPrompt = "Generate chart data for the following request: " + params.prompt + "\n\nReturn ONLY a JSON object in this exact format (no other text):\n" + "{\n" + "  \"data\": [[number, number, ...], [number, number, ...]],\n" + "  \"series\": [\"Series1\", \"Series2\", ...],\n" + "  \"categories\": [\"Category1\", \"Category2\", ...]\n" + "}\n\n" + "IMPORTANT RULES:\n" + "1. The number of arrays in 'data' MUST equal the number of items in 'series'\n" + "2. ALL arrays in 'data' MUST have exactly the same length\n" + "3. The number of items in 'categories' MUST equal the length of each data array\n" + "Example: if data=[[10,20,30],[40,50,60]], then series must have 2 names and categories must have 3 names";

					let generatedData = await requestEngine.chatRequest(chartPrompt, false);

					await checkEndAction();

					try {
						let parsedData = JSON.parse(generatedData);
						Asc.scope.params.data = parsedData.data;
						Asc.scope.params.series = parsedData.series;
						Asc.scope.params.categories = parsedData.categories;

						let dataLength = Asc.scope.params.data.length;
						let seriesLength = Asc.scope.params.series.length;
						let pointsLength = Asc.scope.params.data[0] ? Asc.scope.params.data[0].length : 0;
						let categoriesLength = Asc.scope.params.categories.length;

						for (let i = 1; i < Asc.scope.params.data.length; i++) {
							if (Asc.scope.params.data[i].length !== pointsLength) {
								while (Asc.scope.params.data[i].length < pointsLength) {
									Asc.scope.params.data[i].push(0);
								}
								Asc.scope.params.data[i] = Asc.scope.params.data[i].slice(0, pointsLength);
							}
						}

						if (dataLength !== seriesLength) {
							while (Asc.scope.params.series.length < dataLength) {
								Asc.scope.params.series.push("Series " + (Asc.scope.params.series.length + 1));
							}
							Asc.scope.params.series = Asc.scope.params.series.slice(0, dataLength);
						}

						if (pointsLength !== categoriesLength) {
							while (Asc.scope.params.categories.length < pointsLength) {
								Asc.scope.params.categories.push("Cat " + (Asc.scope.params.categories.length + 1));
							}
							Asc.scope.params.categories = Asc.scope.params.categories.slice(0, pointsLength);
						}
					} catch (e) {
						Asc.scope.params.data = [[100, 120, 140], [90, 110, 130]];
						Asc.scope.params.series = ["Series 1", "Series 2"];
						Asc.scope.params.categories = ["Cat 1", "Cat 2", "Cat 3"];
					}
				} catch (error) {
					await checkEndAction();
					Asc.scope.params.data = [[100, 120, 140], [90, 110, 130]];
					Asc.scope.params.series = ["Series 1", "Series 2"];
					Asc.scope.params.categories = ["Cat 1", "Cat 2", "Cat 3"];
				}

				await Asc.Editor.callMethod("EndAction", ["GroupActions"]);
			}

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide;

				if (Asc.scope.params.slideNumber) {
					slide = presentation.GetSlideByIndex(Asc.scope.params.slideNumber - 1);
				}
				else {
					slide = presentation.GetCurrentSlide();
				}

				if (!slide) return;

				let chartType = Asc.scope.params.chartType || "bar3D";
				let data = Asc.scope.params.data || [[100, 120, 140], [90, 110, 130]];
				let series = Asc.scope.params.series || ["Series 1", "Series 2"];
				let categories = Asc.scope.params.categories || ["Category 1", "Category 2", "Category 3"];

				if (!data || data.length === 0 || !data[0] || data[0].length === 0) {
					data = [[100, 120, 140], [90, 110, 130]];
					series = ["Series 1", "Series 2"];
					categories = ["Category 1", "Category 2", "Category 3"];
				}

				if (data.length > 0 && data[0].length > 0) {
					let dataLength = data.length;
					let pointsLength = data[0].length;

					for (let i = 1; i < data.length; i++) {
						if (data[i].length !== pointsLength) {
							while (data[i].length < pointsLength) {
								data[i].push(0);
							}
							data[i] = data[i].slice(0, pointsLength);
						}
					}

					if (series.length !== dataLength) {
						while (series.length < dataLength) {
							series.push("Series " + (series.length + 1));
						}
						series = series.slice(0, dataLength);
					}

					if (categories.length !== pointsLength) {
						while (categories.length < pointsLength) {
							categories.push("Category " + (categories.length + 1));
						}
						categories = categories.slice(0, pointsLength);
					}
				}

				let slideWidth = presentation.GetWidth();
				let slideHeight = presentation.GetHeight();
				let width = 5472000;
				let height = 3204000;

				let x = (slideWidth - width) / 2;
				let y = (slideHeight - height) / 2;

				let chart = Api.CreateChart(chartType, data, series, categories, width, height, 24);

				if (chart) {
					chart.SetPosition(x, y);
					slide.AddObject(chart);
				}
			});
		};
		funcs.push(func);
	}


	if (true) {
		let func = new RegisteredFunction();
		func.name = "addTextToPlaceholder";
		func.description = "Universal function for adding ANY text content to slides. Use this for ALL text addition requests: recipes, lists, instructions, notes, ideas, or any other text content.";
		func.params = [
			"slideNumber (number): the slide number to add text to (optional, default current slide)",
			"text (string): ANY text content to add - recipes, lists, instructions, notes, ideas, descriptions, stories, data, or whatever user asks to add",
			"textType (string): type of text - 'body', 'chart', 'clipArt', 'ctrTitle', 'diagram', 'date', 'footer', 'header', 'media', 'object', 'picture', 'sldImage', 'sldNumber', 'subTitle', 'table', 'title' (optional, default 'body')",
			"prompt (string): AI instructions for text enhancement or generation (optional)"
		];
		func.examples = [
			"IMPORTANT: Use this function for ANY text addition request!",
			"if user asks 'add [anything]' or 'write [anything]' or 'create text about [anything]', respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"text\": \"[generated or specified content]\", \"textType\": \"body\"}",
			"if user asks 'add recipe for coffee' or just 'recipe for coffee', respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"text\": \"Coffee Recipe:\\n1. Grind coffee beans\\n2. Heat water to 95°C\\n3. Pour water over coffee\\n4. Wait 4 minutes\\n5. Enjoy\", \"textType\": \"body\"}",
			"if user asks 'insert shopping list' or 'shopping list', respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"text\": \"Shopping List:\\n- Milk\\n- Bread\\n- Eggs\\n- Coffee\\n- Sugar\", \"textType\": \"body\"}",
			"if user asks 'put some text' or 'add some information', respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"text\": \"[the requested information]\", \"textType\": \"body\"}",
			"if user asks 'add meeting notes' or 'meeting agenda', respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"text\": \"Meeting Notes:\\n- Introduction\\n- Main topics\\n- Action items\\n- Next steps\", \"textType\": \"body\"}",
			"if user asks to add title to slide 1, respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"slideNumber\": 1, \"text\": \"Introduction\", \"textType\": \"title\"}",
			"if user asks to generate content, respond with:\n" +
			"[functionCalling (addTextToPlaceholder)]: {\"text\": \"Topic\", \"textType\": \"body\", \"prompt\": \"generate detailed content about this topic\"}"
		];

		func.call = async function (params) {
			Asc.scope.slideNum = params.slideNumber;
			Asc.scope.text = params.text;
			Asc.scope.textType = params.textType || "body";
			Asc.scope.prompt = params.prompt;

			await Asc.Editor.callCommand(function () {
				let presentation = Api.GetPresentation();
				let slide;

				if (Asc.scope.slideNum) {
					slide = presentation.GetSlideByIndex(Asc.scope.slideNum - 1);
				}
				else {
					slide = presentation.GetCurrentSlide();
				}

				if (!slide) return;

				const placeholderGroups = {
					titles: ['title', 'ctrTitle'],
					subTitles: ['subTitle'],
					content: ['body', 'object', 'unknown'],
					media: ['picture', 'chart', 'media', 'clipArt', 'diagram', 'sldImage', 'table'],
					footer: ['footer', 'date', 'sldNumber', 'header']
				};

				function findPlaceholderGroup(type) {
					for (let groupName in placeholderGroups) {
						if (placeholderGroups[groupName].includes(type)) {
							return placeholderGroups[groupName];
						}
					}
					return [type];
				}

				function findShapeByPlaceholderType(slide, placeholderTypes) {
					let allDrawings = slide.GetAllDrawings();

					for (let type of placeholderTypes) {
						for (let i = 0; i < allDrawings.length; i++) {
							let drawing = allDrawings[i];

							let ph = drawing.GetPlaceholder();
							if (ph) {
								if (ph.GetType() === type) {
									return {shape: drawing, foundType: type};
								}
							}
						}
					}

					return null;
				}

				let placeholderGroup = findPlaceholderGroup(Asc.scope.textType);

				let searchResult = findShapeByPlaceholderType(slide, placeholderGroup);
				let targetShape = searchResult ? searchResult.shape : null;
				let foundType = searchResult ? searchResult.foundType : null;

				if (!targetShape && !placeholderGroups.content.includes(Asc.scope.textType)) {
					searchResult = findShapeByPlaceholderType(slide, placeholderGroups.content);
					targetShape = searchResult ? searchResult.shape : null;
					foundType = searchResult ? searchResult.foundType : null;
				}

				let bNewShape = false;
				if (!targetShape) {
					let slideWidth = presentation.GetWidth();
					let slideHeight = presentation.GetHeight();

					let sizes = {
						title: {width: 0.8, height: 0.1},
						ctrTitle: {width: 0.8, height: 0.1},
						subTitle: {width: 0.8, height: 0.08},
						body: {width: 0.8, height: 0.6},
						object: {width: 0.8, height: 0.6},
						picture: {width: 0.5, height: 0.4},
						chart: {width: 0.6, height: 0.5},
						table: {width: 0.8, height: 0.6},
						media: {width: 0.6, height: 0.5},
						clipArt: {width: 0.3, height: 0.3},
						diagram: {width: 0.7, height: 0.5},
						sldImage: {width: 0.6, height: 0.5},
						footer: {width: 0.8, height: 0.06},
						header: {width: 0.8, height: 0.06},
						date: {width: 0.2, height: 0.04},
						sldNumber: {width: 0.1, height: 0.04}
					};

					let size = sizes[Asc.scope.textType] || sizes.body;
					let shapeWidth = slideWidth * size.width;
					let shapeHeight = slideHeight * size.height;
					let x = (slideWidth - shapeWidth) / 2;
					let y = (slideHeight - shapeHeight) / 2;

					let oFill = Api.CreateNoFill();
					let oStroke = Api.CreateStroke(0, Api.CreateNoFill());
					targetShape = Api.CreateShape("rect", shapeWidth, shapeHeight, oFill, oStroke);
					targetShape.SetPosition(x, y);

					slide.AddObject(targetShape);
					foundType = Asc.scope.textType;
					bNewShape = true;
				}

				let docContent = targetShape.GetDocContent();
				if (docContent) {
					let internalContent = docContent.Content || docContent;

					while (internalContent.GetElementsCount() > 1) {
						internalContent.RemoveElement(1);
					}

					let lines = Asc.scope.text.split('\n').filter(line => line.trim() !== '');

					if (lines.length === 1) {
						let paragraph = internalContent.GetElement(0);
						if (paragraph) {
							paragraph.RemoveAllElements();
							paragraph.AddText(lines[0]);
						}
					}
					else {
						let firstParagraph = internalContent.GetElement(0);
						if (firstParagraph) {
							firstParagraph.RemoveAllElements();
							let run = firstParagraph.AddText(lines[0]);
							if (bNewShape) {
								run.SetFill(Api.CreateSolidFill(Api.CreateSchemeColor("tx1")));
							}
						}

						for (let i = 1; i < lines.length; i++) {
							let newParagraph = Api.CreateParagraph();
							let run = newParagraph.AddText(lines[i]);
							if (bNewShape) {
								run.SetFill(Api.CreateSolidFill(Api.CreateSchemeColor("tx1")));
							}
							internalContent.Push(newParagraph);
						}
					}

					return;
				}

				return;
			});

		};
		funcs.push(func);
	}
	return funcs;
}
