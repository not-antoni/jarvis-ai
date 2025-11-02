# Migrations

Store database migrations in this directory. Files should follow the
`YYYYMMDDHHMM-description.js` naming convention so they execute in order.

Each migration module must export an object with an `id`, `description`, and
an asynchronous `up` function:

```js
module.exports = {
    id: '20240510_initial_seed',
    description: 'Populate default settings',
    async up({ db, logger }) {
        const collection = db.collection('example');
        await collection.insertOne({ ready: true });
        logger('Inserted example document');
    }
};
```

Optional `down` handlers are supported but not required. The migration runner
records applied migrations in the `migrations` collection, so rerunning the
script skips completed work.
