// TODO: MOVE THIS TO LIB

/* global describe, beforeEach, before, after, it */

//import * as  _ from 'underscore';
//import * as sinon from 'sinon';
import {assert} from 'chai';

import {Range} from '../lib/LongScroll';

//var ko = require('knockout');
//var Mousetrap = require('app/client/lib/Mousetrap');
//var clientUtil = require('../clientUtil');
//

describe("LongScroll",  function() {

    function assertRangeEqual(a: Range, b: Range){
        assert(a.equals(b), `${a} should equal ${b}`);
    }

    function assertRangeNotEqual(a: Range, b: Range){
        assert(!a.equals(b), `${a} shouldn't equal ${b}`);
    }

    describe("range",  function () {
        it("should have basic functionality", function() {
            const r = new Range(5, 10);
            assert.equal(r.top, 5);
            assert.equal(r.bot, 10);
        });

        it("should handle heights correctly", function() {
            const r1 = new Range(0,0);
            const r2 = new Range(-3,-2);
            const r3 = new Range(193,294);
            assert.equal(r1.height, 0);
            assert.equal(r2.height, 1);
            assert.equal(r3.height, 101);
            assert.throws(() => new Range(20, 10), /top \> bottom/);
        });


        it("should implement contains", function() {
            const r1 = new Range(0,0);
            const r2 = new Range(-3,3);
            const r3 = new Range(10,20);

            assert(! r1.contains(-1));
            assert(! r1.contains(0));
            assert(! r1.contains(1));

            assert(! r2.contains(-4), "-3,3 shouldnt contain -4");
            assert(  r2.contains(-3), "-3,3 should   contain -3");
            assert(  r2.contains(-2), "-3,3 should   contain -2");
            assert(  r2.contains(-1), "-3,3 should   contain -1");
            assert(  r2.contains( 0), "-3,3 should   contain  0");
            assert(  r2.contains( 1), "-3,3 should   contain  1");
            assert(  r2.contains( 2), "-3,3 should   contain  2");
            assert(! r2.contains( 3), "-3,3 shouldnt contain  3");
            assert(! r2.contains( 4), "-3,3 shouldnt contain  4");
            assert(! r2.contains( 5), "-3,3 shouldnt contain  5");

            assert(r3.contains(new Range(10,20)), "10,20 should contain 10,20");
            assert(r3.contains(new Range(10,15)), "10,20 should contain 10,15");
            assert(r3.contains(new Range(15,19)), "10,20 should contain 15,19");

            assert(!r3.contains(new Range(9,10)));
            assert(!r3.contains(new Range(15, 21)));
            assert(!r3.contains(new Range(0, 100)));
            assert(!r3.contains(new Range(-100, 20)));
            assert(!r3.contains(new Range(-100, 100)));

            assert(!r3.contains(new Range(0,1)));

            assert(r2.contains(new Range(0,0)), "should contain empty ranges");
            assert(r3.contains(new Range(0,0)), "should contain empty ranges");
            assert(r3.contains(new Range(100,100)), "should contain empty ranges");
        });

        it("should implement equals", function() {
            const r1 = new Range(-10, 10);
            const r2 = new Range(-10, 10);

            const r3 = new Range(5, 10);
            const r4 = new Range(5, 10);

            const r5 = new Range(-10, 0);
            const r6 = new Range(-10, 0);

            assertRangeEqual(r1, r1);
            assertRangeEqual(r1, r2);
            assertRangeEqual(r2, r1);
            assertRangeEqual(r2, r2);

            assertRangeEqual(r3, r4);
            assertRangeEqual(r4, r3);

            assertRangeEqual(r5, r6);
            assertRangeEqual(r6, r5);

            assertRangeNotEqual(r1, r3);
            assertRangeNotEqual(r1, r4);
            assertRangeNotEqual(r1, r5);
            assertRangeNotEqual(r1, r6);
        });

        it("should implement clampTo", function() {
            const rL = new Range(-100, 6); // left
            const rR = new Range(-2, 100); // right
            const rB = new Range(-100, 100); // big

            const r1 = new Range(-15, 15);

            assertRangeEqual(rL.clampTo(r1), new Range(-15, 6));
            assertRangeEqual(rR.clampTo(r1), new Range(-2, 15));
            assertRangeEqual(rB.clampTo(r1), new Range(-15, 15));


            //shouldnt change when contained
            assertRangeEqual(r1.clampTo(rB), r1);

            //should empty when clamped to empty
            assert.equal(r1.clampTo(new Range(30,30)).height, 0, "Should be empty when clamped to empty");
        });
    });


    /* TO TEST
     * Check with floats????
     * unify? should be callable with numbers or range
     *
     * clampTo
     *
     * immutability??
     */

});
