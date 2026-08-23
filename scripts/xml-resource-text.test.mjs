import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAndroidStringResources } from './xml-resource-text.mjs';

test('extracts inert text from nested Android string resources', () => {
  const values = parseAndroidStringResources(
    `<?xml version="1.0" encoding="utf-8"?>
     <resources>
       <string name="rich">Focus <b>now</b> &amp; later</string>
       <plurals name="timers"><item quantity="one">One timer</item><item quantity="other">Many timers</item></plurals>
     </resources>`,
    'inline-test.xml'
  );

  assert.equal(values.get('rich'), 'Focus now & later');
  assert.equal(values.get('timers'), 'One timerMany timers');
});

test('rejects malformed Android string resources', () => {
  assert.throws(
    () =>
      parseAndroidStringResources(
        '<resources><string name="broken">Missing close</resources>',
        'broken.xml'
      ),
    /Invalid Android string resources in broken\.xml/
  );
});
