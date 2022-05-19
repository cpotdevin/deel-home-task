const express = require('express');
const bodyParser = require('body-parser');
const Sequelize = require('sequelize');
const { sequelize } = require('./model');
const { getProfile } = require('./middleware/getProfile');

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

app.get('/contracts/:id', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models');
  const { id } = req.params;
  const contract = await Contract.findOne({ where: { id } });

  if (!contract) {
    return res.status(404).end();
  }

  if (
    contract.ContractorId !== req.profile.id &&
    contract.ClientId !== req.profile.id
  ) {
    return res.status(403).end();
  }

  res.json(contract);

  return null;
});

app.get('/contracts', getProfile, async (req, res) => {
  const { Contract } = req.app.get('models');
  const { id } = req.profile;
  const contracts = await Contract.findAll({
    where: {
      status: { [Sequelize.Op.not]: 'terminated' },
      [Sequelize.Op.or]: [{ ClientId: id }, { ContractorId: id }],
    },
  });

  res.json(contracts);

  return null;
});

module.exports = app;
