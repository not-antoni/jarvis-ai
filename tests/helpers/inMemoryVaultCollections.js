const crypto = require('node:crypto');

function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function matchesFilter(doc = {}, filter = {}) {
    const toComparable = value => {
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'string') {
            const asDate = Date.parse(value);
            if (!Number.isNaN(asDate)) return asDate;
        }
        return value;
    };

    const matchesCondition = (docValue, condition) => {
        if (
            condition &&
            typeof condition === 'object' &&
            !Array.isArray(condition) &&
            !(condition instanceof Date)
        ) {
            if (Object.prototype.hasOwnProperty.call(condition, '$in')) {
                const haystack = Array.isArray(condition.$in) ? condition.$in : [];
                return haystack.includes(docValue);
            }
            if (Object.prototype.hasOwnProperty.call(condition, '$lt')) {
                return toComparable(docValue) < toComparable(condition.$lt);
            }
            if (Object.prototype.hasOwnProperty.call(condition, '$gt')) {
                return toComparable(docValue) > toComparable(condition.$gt);
            }
        }

        return docValue === condition;
    };

    return Object.entries(filter).every(([key, value]) => matchesCondition(doc[key], value));
}

function createUserKeysCollection() {
    const docs = [];

    return {
        async createIndex() {
            return 'ok';
        },
        async findOne(filter = {}) {
            const record = docs.find(doc => matchesFilter(doc, filter));
            return record ? deepClone(record) : null;
        },
        async insertOne(doc) {
            const record = { ...deepClone(doc), _id: crypto.randomUUID() };
            docs.push(record);
            return { insertedId: record._id };
        },
        async deleteOne(filter = {}) {
            const index = docs.findIndex(doc => matchesFilter(doc, filter));
            if (index === -1) {
                return { deletedCount: 0 };
            }
            docs.splice(index, 1);
            return { deletedCount: 1 };
        }
    };
}

function sortDocuments(docs, sortSpec = {}) {
    const [[field, direction]] = Object.entries(sortSpec).length
        ? Object.entries(sortSpec)
        : [[null, 1]];

    if (!field) {
        return docs.slice();
    }

    const normalizedDirection = direction >= 0 ? 1 : -1;
    return docs.slice().sort((a, b) => {
        const aValue = a[field];
        const bValue = b[field];

        if (aValue === bValue) return 0;
        return aValue > bValue ? normalizedDirection : -normalizedDirection;
    });
}

function createMemoriesCollection() {
    const docs = [];

    return {
        async createIndex() {
            return 'ok';
        },
        async countDocuments(filter = {}) {
            return docs.filter(doc => matchesFilter(doc, filter)).length;
        },
        async insertOne(doc) {
            const record = { ...deepClone(doc), _id: crypto.randomUUID() };
            docs.push(record);
            return { insertedId: record._id };
        },
        find(filter = {}) {
            const filtered = docs.filter(doc => matchesFilter(doc, filter));

            return {
                sort(sortSpec = {}) {
                    const sorted = sortDocuments(filtered, sortSpec);

                    return {
                        limit(limitValue) {
                            const limited =
                                typeof limitValue === 'number'
                                    ? sorted.slice(0, limitValue)
                                    : sorted.slice();

                            return {
                                async toArray() {
                                    return limited.map(doc => deepClone(doc));
                                }
                            };
                        }
                    };
                }
            };
        },
        async deleteMany(filter = {}) {
            const retained = docs.filter(doc => !matchesFilter(doc, filter));
            const deletedCount = docs.length - retained.length;

            docs.length = 0;
            docs.push(...retained);

            return { deletedCount };
        }
    };
}

function createVaultTestCollections() {
    return {
        userKeys: createUserKeysCollection(),
        memories: createMemoriesCollection()
    };
}

module.exports = {
    createVaultTestCollections
};
