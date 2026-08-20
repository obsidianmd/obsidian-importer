/**
 * The in-memory vault, where the website and the tests share it.
 *
 * The implementation moved to web/obsidian/vault.ts: the browser has no vault
 * either, so what a test writes into and what the website collects to hand
 * back are the same thing. Nothing about its behaviour changed here.
 */
export { MemoryVault, memoryApp } from '../../web/obsidian/vault';

/**
 * The same, with the metadata cache the link pass needs. Opt in where a test is
 * about what that pass does; memoryApp leaves it off, and most recordings were
 * made without it.
 */
export { browserApp as indexedApp } from '../../web/obsidian/metadata';
