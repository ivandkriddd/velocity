const express = require('express');
const path = require('path');
const app = express();

const DOWNLOAD_URL = 'https://github.com/ivandkriddd/velocity/releases/download/v1.0.0/Velocity%20Setup%201.0.0.exe';

app.use(express.static(path.join(__dirname, 'website')));

app.get('/download', (req, res) => {
  res.redirect(302, DOWNLOAD_URL);
});

app.get('/download/latest', (req, res) => {
  res.redirect(302, DOWNLOAD_URL);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Velocity download site running on port ' + PORT));
