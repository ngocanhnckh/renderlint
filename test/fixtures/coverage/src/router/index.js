// What renderlint reads to know the app's routes (the page itself is plain JS in app.js).
import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: () => import('../views/About.vue') },
    { path: '/products/:id', component: () => import('../views/Product.vue') },
    { path: '/users/:id', component: () => import('../views/User.vue') },
    { path: '/admin', component: () => import('../views/Admin.vue'), meta: { roles: ['admin'] } },
    { path: '/settings', component: () => import('../views/Settings.vue'), meta: { requiresAuth: true } },
    { path: '/reports/:id', component: () => import('../views/Report.vue') },
    { path: '/login', component: () => import('../views/Login.vue') },
  ],
})
