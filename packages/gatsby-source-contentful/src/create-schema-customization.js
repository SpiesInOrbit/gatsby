// @ts-check
const _ = require(`lodash`)
const v8 = require(`v8`)
const fs = require(`fs-extra`)

const { createPluginConfig } = require(`./plugin-options`)
const { fetchContentTypes } = require(`./fetch`)
const { CODES } = require(`./report`)
import { getFileSystemCachePath } from "./fs-cache"

export async function createSchemaCustomization(
  { schema, actions, reporter, cache },
  pluginOptions
) {
  const { fsForceCache, fsCacheFileExists, fsCacheFilePath } =
    await getFileSystemCachePath({ suffix: `content-type` })
  const { createTypes } = actions

  const pluginConfig = createPluginConfig(pluginOptions)

  // Get content type items from Contentful
  let contentTypeItems
  if (!fsCacheFileExists) {
    // Fetch content types as long fs cache is disabled or the fs cache file does not exist
    contentTypeItems = await fetchContentTypes({ pluginConfig, reporter })

    // Cache file to FS if required
    if (fsForceCache) {
      reporter.info(
        `GATSBY_CONTENTFUL_EXPERIMENTAL_FORCE_CACHE was set. Writing v8 serialized glob of remote content type data to: ` +
          fsCacheFilePath
      )
      await fs.writeFile(fsCacheFilePath, v8.serialize(contentTypeItems))
    }
  } else {
    // Load the content type item data from FS
    reporter.info(
      `GATSBY_CONTENTFUL_EXPERIMENTAL_FORCE_CACHE was set. Reading v8 serialized glob of remote content type data from: ` +
        fsCacheFilePath
    )
    const contentTypeItemsCacheBuffer = await fs.readFile(fsCacheFilePath)
    contentTypeItems = v8.deserialize(contentTypeItemsCacheBuffer)
  }

  // Check for restricted content type names and set id based on useNameForId
  const useNameForId = pluginConfig.get(`useNameForId`)
  const restrictedContentTypes = [`entity`, `reference`, `asset`]

  if (pluginConfig.get(`enableTags`)) {
    restrictedContentTypes.push(`tags`)
  }

  contentTypeItems.forEach(contentTypeItem => {
    // Establish identifier for content type
    //  Use `name` if specified, otherwise, use internal id (usually a natural-language constant,
    //  but sometimes a base62 uuid generated by Contentful, hence the option)
    let contentTypeItemId
    if (useNameForId) {
      contentTypeItemId = contentTypeItem.name.toLowerCase()
    } else {
      contentTypeItemId = contentTypeItem.sys.id.toLowerCase()
    }

    if (restrictedContentTypes.includes(contentTypeItemId)) {
      reporter.panic({
        id: CODES.FetchContentTypes,
        context: {
          sourceMessage: `Restricted ContentType name found. The name "${contentTypeItemId}" is not allowed.`,
        },
      })
    }
  })

  // Store processed content types in cache for sourceNodes
  const sourceId = `${pluginConfig.get(`spaceId`)}-${pluginConfig.get(
    `environment`
  )}`
  const CACHE_CONTENT_TYPES = `contentful-content-types-${sourceId}`
  await cache.set(CACHE_CONTENT_TYPES, contentTypeItems)

  createTypes(`
    interface ContentfulEntry implements Node {
      contentful_id: String!
      id: ID!
      node_locale: String!
    }
  `)

  createTypes(`
    interface ContentfulReference {
      contentful_id: String!
      id: ID!
    }
  `)

  createTypes(
    schema.buildObjectType({
      name: `ContentfulAsset`,
      fields: {
        contentful_id: { type: `String!` },
        id: { type: `ID!` },
      },
      interfaces: [`ContentfulReference`, `Node`],
    })
  )

  // Create types for each content type
  const gqlTypes = contentTypeItems.map(contentTypeItem =>
    schema.buildObjectType({
      name: _.upperFirst(
        _.camelCase(
          `Contentful ${
            pluginConfig.get(`useNameForId`)
              ? contentTypeItem.name
              : contentTypeItem.sys.id
          }`
        )
      ),
      fields: {
        contentful_id: { type: `String!` },
        id: { type: `ID!` },
        node_locale: { type: `String!` },
      },
      interfaces: [`ContentfulReference`, `ContentfulEntry`, `Node`],
    })
  )

  createTypes(gqlTypes)

  if (pluginConfig.get(`enableTags`)) {
    createTypes(
      schema.buildObjectType({
        name: `ContentfulTag`,
        fields: {
          name: { type: `String!` },
          contentful_id: { type: `String!` },
          id: { type: `ID!` },
        },
        interfaces: [`Node`],
        extensions: { dontInfer: {} },
      })
    )
  }
}