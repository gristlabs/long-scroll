declare class BinaryIndexedTree {

  constructor(size?: number);

  size(): number;

  toCumulativeArray(): number[];
  toValueArray(): number[];

  fillfromcumulative(cumulvalues: number[]): void;
  fillFromValues(values: number[]): void;

  getCumulativeValue(index: number): number;
  getCumulativeValueRange(start:number, end: number): number;
  getSumTo(index: number): number;
  getTotal(): number;

  getValue(index: number): number;
  addValue(index: number, delta: number): number;
  setValue(index: number, value: number): number;
  getIndex(cumulValue: number): number;

}



export = BinaryIndexedTree;
