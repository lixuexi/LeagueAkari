import { lcuConnectionState, lcuEventBus } from '@main/core/lcu-connection'
import { mwNotification } from '@main/core/main-window'
import { getMe } from '@main/http-api/chat'
import { ipcStateSync } from '@main/utils/ipc'
import { ChatPerson, Conversation } from '@shared/types/lcu/chat'
import { formatError } from '@shared/utils/errors'
import { reaction, runInAction } from 'mobx'
import { makeAutoObservable, observable } from 'mobx'

import { logger } from './common'

export interface Conversations {
  championSelect: Conversation | null
  postGame: Conversation | null
  lobby: Conversation | null
}

export interface Participants {
  championSelect: number[] | null
  postGame: number[] | null
  lobby: number[] | null
}

class ChatState {
  conversations = observable<Conversations>(
    {
      championSelect: null,
      postGame: null,
      lobby: null
    },
    {
      championSelect: observable.struct,
      postGame: observable.struct,
      lobby: observable.struct
    },
    { deep: false }
  )

  participants = observable<Participants>(
    {
      championSelect: null,
      postGame: null,
      lobby: null
    },
    {
      championSelect: observable.struct,
      postGame: observable.struct,
      lobby: observable.struct
    },
    { deep: false }
  )

  me: ChatPerson | null = null

  constructor() {
    makeAutoObservable(this, {
      me: observable.struct,
      conversations: observable.shallow,
      participants: observable.shallow
    })
  }

  setMe(me: ChatPerson | null) {
    this.me = me
  }

  setConversationChampSelect(c: Conversation | null) {
    this.conversations.championSelect = c
  }

  setConversationPostGame(c: Conversation | null) {
    this.conversations.postGame = c
  }

  setConversationLobby(c: Conversation | null) {
    this.conversations.lobby = c
  }

  setParticipantsChampSelect(p: number[] | null) {
    this.participants.championSelect = p
  }

  setParticipantsPostGame(p: number[] | null) {
    this.participants.postGame = p
  }

  setParticipantsLobby(p: number[] | null) {
    this.participants.lobby = p
  }
}

export const chat = new ChatState()

export function chatSync() {
  lcuEventBus.on('/lol-chat/v1/conversations/:id', (event, { id }) => {
    if (event.eventType === 'Delete') {
      if (chat.conversations.championSelect?.id === id) {
        runInAction(() => {
          chat.setConversationChampSelect(null)
          chat.setParticipantsChampSelect(null)
        })
      } else if (chat.conversations.postGame?.id === id) {
        runInAction(() => {
          chat.setConversationPostGame(null)
          chat.setParticipantsPostGame(null)
        })
      }
      return
    }

    switch (event.data.type) {
      case 'championSelect':
        if (event.eventType === 'Create') {
          runInAction(() => {
            chat.setConversationChampSelect(event.data)
            chat.setParticipantsChampSelect([])
          })
        } else if (event.eventType === 'Update') {
          chat.setConversationChampSelect(event.data)
        }
        break
      case 'postGame':
        if (event.eventType === 'Create') {
          runInAction(() => {
            chat.setConversationPostGame(event.data)
            chat.setParticipantsPostGame([])
          })
        } else if (event.eventType === 'Update') {
          chat.setConversationPostGame(event.data)
        }
        break
    }
  })

  // 监测用户进入房间
  lcuEventBus.on(
    '/lol-chat/v1/conversations/:conversationId/messages/:messageId',
    (event, param) => {
      if (event.data && event.data.type === 'system' && event.data.body === 'joined_room') {
        if (!event.data.fromSummonerId) {
          return
        }

        if (
          chat.conversations.championSelect &&
          chat.conversations.championSelect.id === param.conversationId
        ) {
          const p = Array.from(
            new Set([...(chat.participants.championSelect ?? []), event.data.fromSummonerId])
          )
          chat.setParticipantsChampSelect(p)
        } else if (
          chat.conversations.postGame &&
          chat.conversations.postGame.id === param.conversationId
        ) {
          const p = Array.from(
            new Set([...(chat.participants.postGame ?? []), event.data.fromSummonerId])
          )
          chat.setParticipantsPostGame(p)
        } else if (
          chat.conversations.lobby &&
          chat.conversations.lobby.id === param.conversationId
        ) {
          const p = Array.from(
            new Set([...(chat.participants.lobby ?? []), event.data.fromSummonerId])
          )
          chat.setParticipantsLobby(p)
        }
      }
    }
  )

  lcuEventBus.on('/lol-chat/v1/me', (event) => {
    if (event.eventType === 'Update' || event.eventType === 'Create') {
      chat.setMe(event.data)
      return
    }

    chat.setMe(null)
  })

  reaction(
    () => lcuConnectionState.state,
    async (state) => {
      if (state === 'connected') {
        try {
          chat.setMe((await getMe()).data)
        } catch (error) {
          mwNotification.warn('lcu-state-sync', '状态同步', '获取聊天状态失败')
          logger.warn(`获取聊天状态失败 ${formatError(error)}`)
        }
      }
    }
  )

  ipcStateSync('lcu/chat/me', () => chat.me)
  ipcStateSync('lcu/chat/conversations/champ-select', () => chat.conversations.championSelect)
  ipcStateSync('lcu/chat/conversations/post-game', () => chat.conversations.postGame)
  ipcStateSync('lcu/chat/conversations/lobby', () => chat.conversations.lobby)
}
