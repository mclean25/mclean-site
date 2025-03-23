---
slug: "/posts/apollo-cache-with-expiry"
pubDate: "Nov 28 2020"
title: "Apollo Cache with Expiry Hook"
description: "Creating a React hook to give cache used in Apollo an expiration"
---

## Intro

At work, we recently discovered an issue with our Apollo queries where they
were retrieving outdated data in some cases. What would happen is a user would
be on some page that uses an Apollo query. Over some lengthy period of time,
they would navigate to some other page and then back again without refreshing
their browser. When they returned back to the page, the data on the page was
stale and not what it would have been if the user had performed a refresh.

## Query fetching in Apollo

As of Apollo v3, the current `fetchPolicy`s can be summarized as follows. You can read more about them [here](https://www.apollographql.com/docs/react/data/queries/#supported-fetch-policies):

- `cache-first`: (default) get the query from the cache if it exists, else
  perform a network call.
- `network-only`: always fetch the query from the network.
- `cache-only`: always fetch the query from the cache.
- `cache-and-network`: return the cache first, but perform the network call in
  the background and return that once finished.

A simple solution to our problem would have been to change the `fetchPolicy` in
the query to `network-only`. This would enforce that the data is always fresh
from the server. However, the query in question is relatively slow and using cache
when possible would be greatly beneficial. The other option would be to use
`cache-and-network`, but we still have the same issue that the stale information
will be returned first until the slow query is done and the accurate information
is displayed.

## Setting an expiry on the cache

The solution we came up with was to set an expiry on the cache so that if a
query is re-executed before some arbitrary amount of time, the cache will be used
for performance. If it's after that time limit, we'll then send a fresh network
call to get fresh data. This allows us to set some reasonable amount of time
that we expect the data could become stale while still optimizing for performance.

So how does this look in practice?

We took some inspiration from [this post](https://www.assurantlabs.com/blog/2020/07/20/cache-expiration-in-apollo-graphql-using-react-hooks/), where the authors created a
React hook to fetch the policy based on state stored in `localStorage` for a React Native app. For our purposes, we made a few key modifications:

1. State management of the expiration was placed into app memory instead of
   local storage. This way, when the user refreshes the page and the cache of the app gets flushed, our cache expiry store will also be reset along with it.
2. Because we're not using `async` storage or equivalent, we remove the need
   for `useEffect()` in the hook.
3. Automatic, `variables` based key generation. I'll explain more on this later on.

Our hook thus ends up looking like this:

#### `useCacheWithExpiry.tsx`

```ts
/**
 * A hook to change the Apollo fetch policy based on a given time limit
 *
 * @param expiration - Time to expiry the cache after
 * @param queryName - Name of the query using this fetchPolicy
 * @param variables - The variables that are being used in the query
 * (Note: include all possible properties)
 */
const useCacheWithExpiry = (
  expiration: moment.Duration,
  queryName: string,
  variables: Record<string, any>,
  useContext = useContextDefault,
): FetchPolicy => {
  const { currentState, updateState } = useContext(CacheExpiryContext);
  const key = buildCacheKey(componentName, queryName, variables);
  if (
    !(key in currentState) ||
    moment().diff(moment(currentState[key])) > expiration.asMilliseconds()
  ) {
    updateState({ [key]: moment().toISOString() });
    return "network-only";
  }

  return "cache-first";
};

export default useCacheWithExpiry;
```

## Key generation

The hook is admittedly quite busy with arguments, but it's vital that you give
the cache a key that is unique to each query. Take, for example, a query called
`getAllFiles` that takes an argument `isDeleted: Boolean`. If you were to set
the cache key as just `getAllFiles`, running a query with `{ isDeleted: false }`,
and then another query with `{ isDeleted: true }`, the cache expiry time stamp
would return incorrect results. This is equally important with paginated queries.

This is how we build the key:

```tsx
/**
 * Builds a key string to be used in the cacheExpiry store
 *
 * @param queryName - Name of the query using this fetchPolicy
 * @param variables - The variables that are being used in the query
 * (Note: include all possible properties)
 */
export const buildCacheKey = (
  queryName: string,
  variables: Record<string, any>,
): string => {
  var cacheKey = `lastFetch-${queryName}`;
  Object.entries(variables).forEach((entry: Record<string, any>) => {
    // Only use if the value is not an object (a primative). Safety check since
    // only primatives should be sent as variables to Apollo anyhow
    if (entry[1] !== Object(entry[1])) {
      cacheKey += `-${entry[0]}:${entry[1]}`;
    }
  });
  return cacheKey;
};
```

For our previous example, this would spit out `lastFetch-getAllFiles-isDeleted:true`.

## Using the hook

Using the hook is then fairly straightforward. In your component, your code will
look something like this:

```tsx
const MyComponent: React.FC = () => {
    // ...
    const queryVars = {...}
    const fetchPolicy = useCacheWithExpiry(
        moment.Duration({'seconds': 120})
        "someQueryName",
        queryVars
    )

    const useQuery<DataT, VarsT>(
        _QUERY,
        {
            variables: queryVars,
            fetchPolicy: fetchPolicy
        }
    )
    // ...
}
```
