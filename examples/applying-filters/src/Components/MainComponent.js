import React from 'react';
import columns from '../columns';
import model from '../model';
import UIKernel from 'uikernel';
import FiltersForm from './FiltersForm';

const DEFAULT_FILTERS = {
  search: '',
  age: null,
  gender: 0,
};

class MainComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      model,
      filters: DEFAULT_FILTERS
    };
  }

  onFiltersChange(filters) {
    this.setState({
      filters,
      model: UIKernel.applyGridFilters(model, filters)
    });
  }

  saveChanges() {
    this.grid.save()
      .catch(() => {
        alert('Error');
      });
  }

  clearChanges() {
    this.grid.clearAllChanges();
  }

  render() {
    return (
      <div>
        <div className="panel panel-primary">
          <div className="panel-heading">
            <h3 className="panel-title">Filters</h3>
          </div>
          <div className="panel-body">
            <FiltersForm
              filters={this.state.filters}
              onChange={filters => this.onFiltersChange(filters)}
              onClear={() => this.onFiltersChange(DEFAULT_FILTERS)}
            />
          </div>
        </div>
        <div className="panel panel-info">
          <div className="panel-heading">
            <h3 className="panel-title">Records</h3>
          </div>
          <UIKernel.Grid
            model={this.state.model} // Grid model
            cols={columns} // columns configuration
            viewCount={10} // display 10 records per page
          />
        </div>
      </div>
    );
  }
}

export default MainComponent