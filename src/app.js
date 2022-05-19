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
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
  const { Job, Contract } = req.app.get('models');
  const { id } = req.profile;
  const unpaidJobs = await Job.findAll({
    where: {
      paid: false,
    },
    include: {
      model: Contract,
      required: true,
      attributes: [],
      where: {
        status: 'in_progress',
        [Sequelize.Op.or]: [{ ClientId: id }, { ContractorId: id }],
      },
    },
    joinTableAttributes: [],
  });

  res.json(unpaidJobs);
});

app.post('/jobs/:id/pay', getProfile, async (req, res) => {
  const { Profile, Job, Contract } = req.app.get('models');
  const { id } = req.params;

  const transaction = await sequelize.transaction();

  try {
    const job = await Job.findOne({
      transaction,
      where: { id },
      include: {
        model: Contract,
        required: true,
      },
    });
    const client = await Profile.findOne({
      transaction,
      where: { id: req.profile.id },
    });
    const contractor = await Profile.findOne({
      transaction,
      where: { id: job.Contract.ContractorId },
    });

    if (!job) {
      return res.status(404).end();
    }

    if (job.Contract.ClientId !== req.profile.id) {
      return res.status(403).end();
    }

    if (job.price > client.balance) {
      return res.status(409).end();
    }

    if (job.paid) {
      return res.status(409).end();
    }

    await client.decrement('balance', {
      by: job.price,
      transaction,
    });
    await contractor.increment('balance', {
      by: job.price,
      transaction,
    });
    const paidJob = await job.update(
      { paid: true, paymentDate: Date.now() },
      { transaction },
    );

    await transaction.commit();

    res.json(paidJob);
  } catch (error) {
    await transaction.rollback();
  }

  return null;
});

app.post('/balances/deposit/:id', async (req, res) => {
  const { Job, Contract, Profile } = req.app.get('models');
  const { amount } = req.body;
  const { id } = req.params;

  if (typeof amount !== 'number') {
    return res.status(400).end();
  }

  const result = await Job.findOne({
    attributes: [[sequelize.fn('sum', sequelize.col('price')), 'unpaidAmount']],
    where: {
      paid: false,
    },
    include: {
      model: Contract,
      required: true,
      attributes: [],
      where: {
        status: 'in_progress',
        ClientId: id,
      },
    },
    joinTableAttributes: [],
    group: 'Contract.ClientId',
  });

  const { unpaidAmount } = result.dataValues;

  if (amount > 0.25 * unpaidAmount) {
    return res.status(409).end();
  }

  const client = await Profile.findOne({ where: { id } });

  await client.increment({ balance: amount });

  const clientResult = await Profile.findOne({ where: { id } });

  res.json(clientResult);

  return null;
});

app.get('/admin/best-profession', async (req, res) => {
  const { Job, Contract, Profile } = req.app.get('models');
  const { start: startString, end: endString } = req.query;
  const start = new Date(startString);
  const end = new Date(endString);

  // eslint-disable-next-line no-self-compare
  if (end.getTime() !== end.getTime() || start.getTime() !== start.getTime()) {
    return res.status(409).end();
  }

  const result = await Job.findAll({
    attributes: [[sequelize.fn('sum', sequelize.col('price')), 'moneyEarned']],
    where: {
      paid: true,
      paymentDate: {
        [Sequelize.Op.and]: [
          { [Sequelize.Op.gte]: start },
          { [Sequelize.Op.lte]: end },
        ],
      },
    },
    include: {
      model: Contract,
      required: true,
      attributes: ['ContractorId'],
      include: {
        model: Profile,
        as: 'Contractor',
        foreignKey: 'ContractorId',
        required: true,
        attributes: ['profession'],
      },
    },
    group: 'Contract.Contractor.profession',
    order: [[Sequelize.col('moneyEarned'), 'DESC']],
    limit: 1,
  });

  if (result.length === 0) {
    res.json('');
  } else {
    res.json(result[0].Contract.Contractor.profession);
  }

  return null;
});

app.get('/admin/best-clients', async (req, res) => {
  const { Job, Contract, Profile } = req.app.get('models');
  const { start: startString, end: endString, limit: limitString } = req.query;
  const start = new Date(startString);
  const end = new Date(endString);
  const limit = Number.parseInt(limitString, 10) || 2;

  // eslint-disable-next-line no-self-compare
  if (end.getTime() !== end.getTime() || start.getTime() !== start.getTime()) {
    return res.status(409).end();
  }

  const result = await Job.findAll({
    limit,
    attributes: [[sequelize.fn('sum', sequelize.col('price')), 'moneyPaid']],
    where: {
      paid: true,
      paymentDate: {
        [Sequelize.Op.and]: [
          { [Sequelize.Op.gte]: start },
          { [Sequelize.Op.lte]: end },
        ],
      },
    },
    include: {
      model: Contract,
      required: true,
      attributes: ['ClientId'],
      include: {
        model: Profile,
        as: 'Client',
        foreignKey: 'ClientId',
        required: true,
        attributes: ['firstName', 'lastName'],
      },
    },
    group: 'Contract.ClientId',
    order: [[Sequelize.col('moneyPaid'), 'DESC']],
  });

  res.json(
    result.map((item) => ({
      id: item.Contract.ClientId,
      fullName: `${item.Contract.Client.firstName} ${item.Contract.Client.lastName}`,
      paid: item.dataValues.moneyPaid,
    })),
  );

  return null;
});

module.exports = app;
