// Copyright (c) 2020 The Brave Authors. All rights reserved.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

import { Middleware } from 'redux'
import { loadTimeData } from '$web-common/loadTimeData'

const isBraveNewsEnabled = loadTimeData.getBoolean('braveNewsEnabled')

// No-op middleware when Brave News is disabled
const noopMiddleware: Middleware = () => (next) => (action) => next(action)

function createBraveNewsMiddleware(): Middleware {
  // Dynamic imports to avoid loading brave_news modules when disabled
  const getBraveNewsController =
    require('../../brave_news/browser/resources/shared/api').default
  const BraveNews =
    require('../../brave_news/browser/resources/shared/api')
  const { addFeedListener } =
    require('../../brave_news/browser/resources/shared/feedListener')
  const AsyncActionHandler =
    require('../../common/AsyncActionHandler').default
  const Actions = require('../actions/today_actions')
  const store = require('../store').default

  addFeedListener((hash: string) => {
    const current = store.getState().today.feed?.hash
    store.dispatch(Actions.isUpdateAvailable({
      isUpdateAvailable: current !== hash
    }))
  })

  function storeInHistoryState(data: Object) {
    const oldHistoryState =
      typeof history.state === 'object' ? history.state : {}
    const newHistoryState = { ...oldHistoryState, ...data }
    history.pushState(newHistoryState, document.title)
  }

  const handler = new AsyncActionHandler()

  handler.on(
    Actions.refresh.getType(),
    async (store: any) => {
      try {
        console.debug('Brave News: Getting data...')
        const [{ feed }, { publishers }] = await Promise.all([
          getBraveNewsController().getFeed(),
          getBraveNewsController().getPublishers()
        ])
        console.debug('Brave News: ...data received.')
        store.dispatch(Actions.dataReceived({ feed, publishers }))
      } catch (e) {
        console.error('error receiving feed', e)
        store.dispatch(Actions.errorGettingDataFromBackground(e))
      }
    }
  )

  handler.on(Actions.ensureSettingsData.getType(), async (store: any) => {
    const state = store.getState()
    if (state.today.publishers &&
        Object.keys(state.today.publishers).length) {
      return
    }
    const { publishers } = await getBraveNewsController().getPublishers()
    store.dispatch(Actions.dataReceived({ publishers }))
  })

  handler.on(
    Actions.readFeedItem.getType(),
    async (store: any, payload: any) => {
      const state = store.getState()
      if (payload.isPromoted) {
        const promotedArticle = payload.item.promotedArticle
        if (!promotedArticle) {
          console.error(
            'Brave News: readFeedItem payload with invalid promoted article',
            payload
          )
          return
        }
        if (!payload.promotedUUID) {
          console.error(
            'Brave News: invalid promotedUUID for readFeedItem',
            payload
          )
          return
        }
        getBraveNewsController().onPromotedItemVisit(
          payload.promotedUUID,
          promotedArticle.creativeInstanceId
        )
      }
      const data =
        payload.item.article?.data ||
        payload.item.promotedArticle?.data ||
        payload.item.deal?.data
      if (!data) {
        console.error(
          'Brave News: readFeedItem payload item not present',
          payload
        )
        return
      }
      if (!payload.openInNewTab) {
        storeInHistoryState({
          todayArticle: data,
          todayPageIndex: state.today.currentPageIndex,
          todayCardsVisited: state.today.cardsVisited
        })
        window.location.href = data.url.url
      } else {
        window.open(data.url.url, '_blank', 'noreferrer')
      }
    }
  )

  handler.on(
    Actions.promotedItemViewed.getType(),
    async (store: any, payload: any) => {
      if (!payload.item.promotedArticle) {
        console.error(
          'Brave News: promotedItemViewed invalid promoted article',
          payload
        )
        return
      }
      getBraveNewsController().onPromotedItemView(
        payload.uuid,
        payload.item.promotedArticle.creativeInstanceId
      )
    }
  )

  handler.on(
    Actions.feedItemViewedCountChanged.getType(),
    async (store: any) => {
      const state = store.getState()
      getBraveNewsController().onNewCardsViewed(
        state.today.cardsViewedDelta
      )
    }
  )

  handler.on(
    Actions.removeDirectFeed.getType(),
    async (store: any, payload: any) => {
      getBraveNewsController().removeDirectFeed(payload.directFeed.publisherId)
      window.setTimeout(() => {
        store.dispatch(Actions.checkForUpdate())
      }, 3000)
    }
  )

  handler.on(
    Actions.setPublisherPref.getType(),
    async (store: any, payload: any) => {
      const { publisherId, enabled } = payload
      let userStatus =
        enabled === null
          ? BraveNews.UserEnabled.NOT_MODIFIED
          : enabled
          ? BraveNews.UserEnabled.ENABLED
          : BraveNews.UserEnabled.DISABLED
      getBraveNewsController().setPublisherPref(publisherId, userStatus)
      window.setTimeout(() => {
        store.dispatch(Actions.checkForUpdate())
      }, 3000)
    }
  )

  handler.on(Actions.checkForUpdate.getType(), async function(store: any) {
    const state = store.getState()
    if (!state.today.feed) {
      store.dispatch(Actions.isUpdateAvailable({ isUpdateAvailable: true }))
      return
    }
    const hash = state.today.feed.hash
    const isUpdateAvailable: { isUpdateAvailable: boolean } =
      await getBraveNewsController().isFeedUpdateAvailable(hash)
    store.dispatch(Actions.isUpdateAvailable(isUpdateAvailable))
  })

  handler.on(
    Actions.resetTodayPrefsToDefault.getType(),
    async function(store: any) {
      getBraveNewsController().clearPrefs()
      const { publishers } = await getBraveNewsController().getPublishers()
      store.dispatch(Actions.dataReceived({ publishers }))
      store.dispatch(Actions.checkForUpdate())
    }
  )

  handler.on(Actions.anotherPageNeeded.getType(), async function(store: any) {
    store.dispatch(Actions.checkForUpdate())
  })

  handler.on(
    Actions.visitDisplayAd.getType(),
    async function(store: any, payload: any) {
      const state = store.getState()
      const todayPageIndex = state.today.currentPageIndex
      getBraveNewsController().onDisplayAdVisit(
        payload.ad.uuid,
        payload.ad.creativeInstanceId
      )
      const destinationUrl = payload.ad.targetUrl.url
      if (!payload.openInNewTab) {
        storeInHistoryState({
          todayAdPosition: todayPageIndex,
          todayPageIndex,
          todayCardsVisited: state.today.cardsVisited
        })
        window.location.href = destinationUrl
      } else {
        window.open(destinationUrl, '_blank', 'noreferrer')
      }
    }
  )

  handler.on(
    Actions.displayAdViewed.getType(),
    async (store: any, item: any) => {
      getBraveNewsController().onDisplayAdView(
        item.ad.uuid,
        item.ad.creativeInstanceId
      )
    }
  )

  return handler.middleware
}

export default isBraveNewsEnabled ? createBraveNewsMiddleware() : noopMiddleware
