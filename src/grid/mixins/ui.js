/*
 * Copyright (с) 2015-present, SoftIndex LLC.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import toPromise from '../../common/toPromise';
import {parents, pick, escape, last, isDefined, pairs} from '../../common/utils';
import {findDOMNode} from 'react-dom';
import React from 'react';
import ThrottleError from '../../common/ThrottleError';
import classNames from 'classnames';

const GridUIMixin = {
  /**
   * Table content click event handler
   *
   * @param {Event} event
   */
  _handleBodyClick(event) {
    const target = event.target;
    const refParent = parents(target, '[ref]')[0];

    let element;

    if (target.classList.contains('dgrid-cell')) {
      element = event.target;
    } else {
      element = parents(target, 'td.dgrid-cell')[0];
    }

    if (
      element
      && !(refParent && refParent.hasAttribute('disabled'))
    ) {
      this._handleCellClick(event, element, (refParent || event.target).getAttribute('ref'));
    }
  },

  /**
   * Cell click handler
   *
   * @param {Event}           event       Event object
   * @param {HTMLElement}     element     Cell DOM element
   * @param {string}          ref         Click handler name in the table configuration
   */
  _handleCellClick(event, element, ref) {
    const colId = element.getAttribute('key');
    const row = element.parentNode.getAttribute('key');
    const columnConfig = this.props.cols[colId];
    const recordId = this.state.recordsInfo[row].id;
    const record = this._getRecordWithChanges(row);

    // Trigger click handler on the table configuration
    if (ref) {
      columnConfig.onClickRefs[ref](event, recordId, record, this);
    } else if (columnConfig.onClick) {
      columnConfig.onClick(event, recordId, record, this);
    }

    // Open cell editor
    if (this.props.cols[colId].editor) {
      this._renderEditor(element, row, colId);
    }
  },

  // TODO Deprecated
  _handleHeaderCellClick(col, event) {
    const target = event.target;
    const refParent = parents(target, '[ref]')[0];
    const ref = (refParent || target).getAttribute('ref');
    let handler;

    if (ref && col.onClickRefs) {
      handler = col.onClickRefs[ref];
      if (handler) {
        return handler(event, this);
      }
    }

    if (col.onClick) {
      col.onClick(event, this);
    }
  },

  /**
   * Fetch server data
   */
  updateTable: async function () {
    this.setState({showLoader: true});

    if (!this.props.model) {
      return;
    }

    const viewCount = this.getViewCount();

    let obj;
    try {
      obj = await this._loadData({
        limit: viewCount,
        offset: this.state.page * viewCount,
        sort: this._sortingToArray(),
        fields: this._getFieldsToRender(),
        extra: this._getAdditionalIds()
      });
    } catch (e) {
      if (!(e instanceof ThrottleError)) {
        throw e;
      }
      return;
    }

    if (!this._isMounted) {
      return;
    }

    if (this.getViewCount() && !obj.hasOwnProperty('count')) {
      throw new Error('Incorrect response from GridModel. "response.count" not defined');
    }

    // If required page is not included in the range of existing pages,
    // request existing in a moment page
    const page = this._checkPage(this.state.page, this.getViewCount(), obj.count);
    if (page !== this.state.page) {
      this.state.page = page;
      this.updateTable();
      return;
    }

    const data = this._dataArrayToObject(obj.records);
    const extra = this._dataArrayToObject(obj.extraRecords || []);
    const recordIds = Object.keys(data.records).concat(Object.keys(extra.records));

    await toPromise(this.setState.bind(this), true)({
      data: Object.assign({}, data.records, extra.records),
      mainIds: Object.keys(data.records),
      count: obj.count,
      totals: obj.totals,
      recordsInfo: Object.assign({}, extra.info, data.info),
      errors: pick(this.state.errors, recordIds),
      changes: pick(this.state.changes, recordIds),
      statuses: pick(this.state.statuses, recordIds)
    });

    this._renderBody();
    this.setState({showLoader: false});
  },

  _getHeaderCellHTML(columnName) {
    const cellHtml = typeof columnName === 'function' ? columnName(this) : columnName;
    if (cellHtml === undefined) {
      return '';
    }
    return cellHtml;
  },

  _escapeRecord(columnId, record) {
    let field;
    let type;
    let i;
    const escapedRecord = {};
    const column = this.props.cols[columnId];
    const needEscaping = !column.hasOwnProperty('escape') || column.escape;
    const fields = column.render.slice(0, -1);

    for (i = 0; i < fields.length; i++) {
      field = fields[i];
      type = typeof record[field];

      if (needEscaping) {
        if (type === 'string') {
          escapedRecord[field] = escape(record[field]);
          continue;
        }

        if (type === 'object' && record[field] && !this.state.colsWithEscapeErrors[columnId]) {
          this.state.colsWithEscapeErrors[columnId] = true;
          console.error(
            `UIKernel.Grid warning: ` +
            `You send record with fields of Object type in escaped column "${columnId}". ` +
            `To use Objects, set column config "escape" to false, ` +
            `and escape "${columnId}" field in render function by yourself`
          );
        }
      }

      escapedRecord[field] = record[field];
    }

    return escapedRecord;
  },

  /**
   * Get table cell HTML
   *
   * @param   {number}   columnId       Column ID
   * @param   {Object}   record         Table record (initial record + changes)
   * @param   {boolean}  selected       "Selected" row status
   * @param   {Object}   initialRecord  Initial record
   * @returns {string}   Table cell HTML
   * @private
   */
  _getCellHTML(columnId, record, selected, initialRecord) {
    const render = last(this.props.cols[columnId].render);
    const cellHtml = render(
      this._escapeRecord(columnId, record),
      selected,
      this._escapeRecord(columnId, initialRecord),
      this
    );
    return `${isDefined(cellHtml) ? cellHtml : ''}`;
  },

  /**
   * Get table row HTML
   *
   * @param       {number}    rowId         Row ID
   * @param       {string}    className   <TR> class attribute
   * @returns     {string}    Table row HTML
   * @private
   */
  _getRowHTML(rowId, className) {
    let colId;
    const record = this._getRecordWithChanges(rowId);
    const initialRecord = this.state.data[rowId] || null;
    const selected = this.isSelected(this.state.recordsInfo[rowId].id);
    const gridRowClass = classNames(
      className,
      this._getRowStatusNames(rowId).join(' '),
      {'dgrid__row_selected': selected}
    );
    let html = `<tr key="${rowId}" class="${gridRowClass}">`;
    for (colId of Object.keys(this.props.cols)) {
      if (this._isViewColumn(colId)) {
        const gridCellClass = classNames(this._getColumnClass(colId), {
          'dgrid-cell': true,
          'dgrid-changed': this._isChanged(rowId, this._getBindParam(colId)),
          'dgrid-error': this._hasError(rowId, this._getBindParam(colId)),
          'dgrid-warning': this._hasWarning(rowId, this._getBindParam(colId))
        });
        html += `
          <td key="${colId}" class="${gridCellClass}">
            ${this._getCellHTML(colId, record, selected, initialRecord)}
          </td>`;
      }
    }
    return `${html}</tr>`;
  },

  /**
   * Redraw table content totally
   *
   * @private
   */
  _renderBody() {
    if (!this.state.data) {
      return;
    }

    let i;
    let row;
    let htmlExtra = '';
    let htmlBody = '';
    const sorted = pairs(this.state.recordsInfo).sort((a, b) => a[1].index - b[1].index);

    for (i = 0; i < sorted.length; i++) {
      row = sorted[i][0];
      if (this._isMainRow(row)) {
        htmlBody += this._getRowHTML(row);
      } else if (this._isChanged(row) || this._getRowStatusNames(row).length) {
        htmlExtra += this._getRowHTML(row, 'others');
      }
    }

    this.tBody.innerHTML = htmlExtra + htmlBody;
  },

  /**
   * Display model changes
   *
   * @param {string} row      Row ID
   * @param {string} param    Model parameter
   * @private
   */
  _renderBinds(row, param) {
    // If parameter does not affect on the redraw, do nothing
    if (!this._isFieldAffectsRender(param)) {
      return;
    }

    const selected = this.isSelected(this.state.recordsInfo[row].id);

    // Update column dependencies
    for (const column of this._getDependentColumns(param)) {
      if (this._isViewColumn(column) && !this._isEditorVisible(row, column)) {
        this._renderCell(row, column, selected);
      }
    }
  },

  _removeTR(rowId) {
    findDOMNode(this.body).removeRow(rowId);
  },

  _renderTotals(isScrollable) {
    let totalsDisplayed = false;
    let i;
    let className;
    let totalsRowHTML = '';
    const header = this._formHeader();

    // If data for result line display exists, form it
    if (this.state.totals) {
      for (i of Object.keys(this.props.cols)) {
        if (!this._isViewColumn(i)) {
          continue;
        }

        className = this.props.cols[i].className;
        if (className) {
          totalsRowHTML += `<td class="${className}">`;
        } else {
          totalsRowHTML += '<td>';
        }

        if (this.state.totals.hasOwnProperty(i)) {
          totalsRowHTML += this._getCellHTML(i, this.state.totals, false, this.state.totals);
          totalsDisplayed = true;
        }

        totalsRowHTML += '</td>';
      }
    }

    if (!totalsDisplayed) {
      return null;
    }

    if (isScrollable) {
      return (
        <table cellSpacing="0" className="dgrid-totals">
          <colgroup>{header.colGroup}</colgroup>
          <tr dangerouslySetInnerHTML={{__html: totalsRowHTML}}/>
        </table>
      );
    }

    return (
      <tfoot className="dgrid-totals">
        <tr dangerouslySetInnerHTML={{__html: totalsRowHTML}}/>
      </tfoot>
    );
  },

  _renderCell(rowId, column, isSelected) {
    const cell = findDOMNode(this.body).querySelector(`tr[key="${rowId}"] td[key=${column}]`);
    const initialRecord = this.state.data[rowId] || null;

    const cellHTML = this._getCellHTML(column, this._getRecordWithChanges(rowId), isSelected, initialRecord);

    try {
      cell.innerHTML = cellHTML;
    } catch (e) {
      // Sometimes it is possible a situation when rerendering of the cell is called in the middle of performing of an
      // event in that cell which may cause an error like "DOMException: The node to be removed is no longer a child
      // of this node", so just ignore it
    }

    cell.classList.remove('dgrid-changed', 'dgrid-error', 'dgrid-warning');
    const cellClassList = [];
    if (this._isChanged(rowId, this._getBindParam(column))) {
      cellClassList.push('dgrid-changed');
    }
    if (this._hasError(rowId, this._getBindParam(column))) {
      cellClassList.push('dgrid-error');
    }
    if (this._hasWarning(rowId, this._getBindParam(column))) {
      cellClassList.push('dgrid-warning');
    }
    cell.classList.add(...cellClassList);
  },

  async _updateRow(row) {
    if (!this.state.data) {
      return;
    }

    if (this.state.data[row]) {
      const selected = this.isSelected(this.state.recordsInfo[row].id);
      const viewColumns = Object.keys(this.props.cols).filter(this._isViewColumn);

      for (const viewColumn of viewColumns) {
        if (!this._isEditorVisible(row, viewColumn)) {
          this._renderCell(row, viewColumn, selected);
        }
      }
    } else {
      await this.updateTable(); // TODO Check is it need
    }
  }
};

export default GridUIMixin;
