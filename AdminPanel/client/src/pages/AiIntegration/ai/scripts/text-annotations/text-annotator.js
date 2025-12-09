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

function TextAnnotator()
{
	this.paraId = null;
	this.rangeId = null;
	
	this.paragraphs = {};
	this.waitParagraphs = {};
	this.paraToCheck = new Set();
	this.checked = new Set(); // was checked on the previous request
	
	this.type = -1;
}
TextAnnotator.prototype.onChangeParagraph = async function(paraId, recalcId, text, ranges)
{
	this._handleNewRanges(ranges, paraId, text);
	this.waitParagraphs[paraId] = {
		recalcId : recalcId,
		text : text
	};
	
	this._checkParagraph(paraId);
};
TextAnnotator.prototype.checkParagraphs = async function(paraIds)
{
	this.paraToCheck.clear()
	let _t = this;
	paraIds.forEach(function(paraId) {
		if (!_t.checked.has(paraId) || _t.waitParagraphs[paraId])
			_t.paraToCheck.add(paraId);
	});
	
	this.paraToCheck.forEach(paraId => this._checkParagraph(paraId));
};
TextAnnotator.prototype._checkParagraph = async function(paraId)
{
	if (!this.paraToCheck.has(paraId) || !this.waitParagraphs[paraId])
		return;
	
	let recalcId = this.waitParagraphs[paraId].recalcId;
	let text = this.waitParagraphs[paraId].text;
	
	// TODO: Temporarily for simplicity
	let range = this.getAnnotationRangeObj(paraId);
	range["rangeId"] = undefined;
	range["all"] = true;
	await Asc.Editor.callMethod("RemoveAnnotationRange", [range]);
	await this.annotateParagraph(paraId, recalcId, text);
	
	delete this.waitParagraphs[paraId];
	this.paraToCheck.delete(paraId);
	
	this.checked.add(paraId);
};
TextAnnotator.prototype.annotateParagraph = async function(paraId, recalcId, text)
{
};
TextAnnotator.prototype.openPopup = async function(paraId, rangeId)
{
	if (!textAnnotatorPopup)
		return;
		
	let popup = textAnnotatorPopup.open(this.type, paraId, rangeId, this.getInfoForPopup(paraId, rangeId));
	if (!popup)
		return;

	let _t = this;
	popup.onAccept = async function() {
		await _t.onAccept(paraId, rangeId);
		_t.closePopup();
	};
	popup.onReject = async function() {
		await _t.onReject(paraId, rangeId);
		_t.closePopup();
	};
};
TextAnnotator.prototype.closePopup = function()
{
	if (!textAnnotatorPopup)
		return;
	
	textAnnotatorPopup.close(this.type);
};
TextAnnotator.prototype.getInfoForPopup = function(paraId, rangeId)
{
	return {};
};
TextAnnotator.prototype.onAccept = async function(paraId, rangeId)
{
};
TextAnnotator.prototype.onReject = async function(paraId, rangeId)
{
	let range = this.getAnnotationRangeObj(paraId, rangeId);
	await Asc.Editor.callMethod("RemoveAnnotationRange", [range]);
};
TextAnnotator.prototype.getAnnotation = function(paraId, rangeId)
{
	if (!paraId || !rangeId || !this.paragraphs[paraId] || !this.paragraphs[paraId][rangeId])
		return {};
	
	return this.paragraphs[paraId][rangeId];
};
TextAnnotator.prototype.getAnnotationRangeObj = function(paraId, rangeId)
{
	return {
		"paragraphId" : paraId,
		"rangeId" : rangeId
	};
};
TextAnnotator.prototype.onClick = function(paraId, ranges)
{
	if (!ranges || !ranges.length)
		this.closePopup();
	else
		this.openPopup(paraId, ranges[0]);
};
TextAnnotator.prototype.onBlur = function()
{
	this.closePopup();
	this.resetCurrentRange();
};
TextAnnotator.prototype.onFocus = function(paraId, rangeId)
{	
};
TextAnnotator.prototype.resetCurrentRange = function()
{
	this.paraId = null;
	this.rangeId = null;
};
TextAnnotator.prototype._handleNewRanges = function(ranges, paraId, text)
{
	if (!ranges || !Array.isArray(ranges))
		return;
	
	ranges.forEach(range => this._handleNewRangePositions(range, paraId, text));
	for (let i = 0; i < ranges.length; ++i)
	{
		this._handleNewRangePositions(ranges[i]);
	}
};
TextAnnotator.prototype._handleNewRangePositions = function(range, paraId, text)
{
};
