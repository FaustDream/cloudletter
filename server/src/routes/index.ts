/**
 * API 路由汇总（V2）：挂载 /auth /posts /categories /tags /settings /search /workbench /uploads /battle。
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

export const api = Router()
api.use('/auth', auth)
api.use('/posts', posts)
api.use('/categories', categories)
api.use('/tags', tags)
api.use('/settings', settings)
api.use('/search', search)
api.use('/workbench', workbench)
api.use('/uploads', uploads)
api.use('/battle', battle)
