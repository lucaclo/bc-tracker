// CSV / paste import parser and header mapping (issue #8). Fixtures are invented people.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imp = require('../public/js/contact-import');

test('RFC 4180: quoted commas, quoted newlines, doubled quotes, CRLF, BOM, blank lines', () => {
  const text = '﻿Name,Notes\r\n"Smith, Jo","said ""hi""\nthen left"\r\n\r\nAl,plain\r\n';
  assert.deepEqual(imp.parseDelimited(text), [
    ['Name', 'Notes'],
    ['Smith, Jo', 'said "hi"\nthen left'],
    ['Al', 'plain']
  ]);
});

test('tab-separated paste (copied from a spreadsheet) and semicolons are detected', () => {
  assert.equal(imp.sniffDelimiter('Name\tCompany\nA\tB'), '\t');
  assert.equal(imp.sniffDelimiter('Name;Company\nA;B'), ';');
  assert.equal(imp.sniffDelimiter('"a,b";c;d\n'), ';');
  assert.deepEqual(imp.parseDelimited('Name\tCompany\nAnn\tUBS'), [['Name', 'Company'], ['Ann', 'UBS']]);
});

test('LinkedIn Connections.csv: skips the Notes preamble and maps every column', () => {
  const csv = [
    'Notes:',
    '"When exporting your connection data, you may notice that some of the email addresses are missing."',
    '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ann,Example,https://www.linkedin.com/in/ann-example,,J.P. Morgan,Analyst,12 Oct 2025',
    'Bob,Sample,https://www.linkedin.com/in/bob-sample,bob@example.com,"Rothschild & Co","Associate, M&A",01 Jan 2024'
  ].join('\n');
  const { headers, rows, mapping } = imp.parseImport(csv);
  assert.equal(headers[0], 'First Name');
  assert.deepEqual(mapping, ['firstName', 'lastName', 'profileUrl', 'email', 'company', 'title', 'connectedOn']);
  const { contacts, skipped } = imp.rowsToContacts(rows, mapping, 'LinkedIn');
  assert.deepEqual(skipped, []);
  assert.deepEqual(contacts[1], {
    name: 'Bob Sample',
    title: 'Associate, M&A',
    company: 'Rothschild & Co',
    email: 'bob@example.com',
    linkedinUrl: 'https://www.linkedin.com/in/bob-sample',
    notes: 'Connected on LinkedIn 01 Jan 2024',
    sourceGroup: 'LinkedIn'
  });
  assert.equal(contacts[0].linkedinUrl, 'https://www.linkedin.com/in/ann-example');
  assert.equal(contacts[0].profileUrl, undefined);
});

test('society sheet with its own headers', () => {
  const { headers, mapping } = imp.parseImport('Member Name,Employer,Job Title,Graduation Year,University,E-mail\nX,Y,Z,2020,Durham,x@y.z');
  assert.equal(headers.length, 6);
  assert.deepEqual(mapping, ['name', 'company', 'title', 'gradYear', 'school', 'email']);
});

test('unknown headers are ignored, duplicates mapped once, user can remap', () => {
  const { rows, mapping } = imp.parseImport('Name,Shoe size,Name\nAnn,7,Ann B');
  assert.deepEqual(mapping, ['name', '', '']);
  const remapped = ['', '', 'name'];
  assert.equal(imp.rowsToContacts(rows, remapped).contacts[0].name, 'Ann B');
});

test('rows without a name are skipped and reported', () => {
  const { rows, mapping } = imp.parseImport('First Name,Last Name,Company\nAnn,,UBS\n,,HSBC\n , ,Citi\nBo,Li,');
  const { contacts, skipped } = imp.rowsToContacts(rows, mapping);
  assert.deepEqual(contacts.map((c) => c.name), ['Ann', 'Bo Li']);
  assert.deepEqual(skipped, [1, 2]);
});

test('empty input gives nothing to import', () => {
  assert.deepEqual(imp.parseImport('   \n\n'), { headers: [], rows: [], mapping: [] });
});
