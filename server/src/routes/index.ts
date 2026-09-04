/**
 * API 路由汇总（V2）：挂载 /auth /posts /categories /tags /settings /search /workbench /uploads /battle /grants /guest
 * + security（设备/头像/2FA 恢复）/ activity（活动日志）/ integrations（API 凭据 + Webhook）/ feeds（RSS 订阅）/ rss.xml（公开 Feed）。
 */
import { Router } from 'express'
import { auth } from './auth'
import { posts } from './posts'
import { categories } from './categories'
import { tags } from './tags'
import { settings } from './settings'
import { search } from './search'
import { workbench } from './workbench'
import { uploads } from './uploads'
import { battle } from './battle'
import { grants } from './grants'
import { guest } from './guest'
import { security } from './security'
import { activity } from './activity'
import { integrations } from './integrations'
import { rss, rssApi } from './rss'

export const api = Router()
api.use('/auth', auth)
api.use('/auth', security) // 设备记录 / 头像 / 2FA 恢复（挂同一前缀）
api.use('/posts', posts)
api.use('/categories', categories)
api.use('/tags', tags)
api.use('/settings', settings)
api.use('/search', search)
api.use('/workbench', workbench)
api.use('/uploads', uploads)
api.use('/battle', battle)
api.use('/grants', grants)
api.use('/guest', guest)
api.use('/activity', activity)
api.use('/integrations', integrations)
api.use('/feeds', rssApi)
api.use('/', rss) // GET /rss.xml（公开）
