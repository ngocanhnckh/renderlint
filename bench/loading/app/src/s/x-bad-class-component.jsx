import React from 'react';
import { Shell } from '../lib.jsx';
export default class Customers extends React.Component {
  state = { items: [] };
  componentDidMount() { fetch('/api/customers?x=cls').then((r) => r.json()).then((d) => this.setState({ items: d.items })); }
  render() {
    return <Shell title="Customers"><div className="card"><h3>All customers</h3><ul>{this.state.items.map((c) => <li key={c.id}>{c.customer}</li>)}</ul></div></Shell>;
  }
}
