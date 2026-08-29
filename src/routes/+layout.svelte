<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import '../app.css';
	import { applyTheme } from '$lib/theme';

	let { children }: { children: Snippet } = $props();

	onMount(() => applyTheme());
</script>

{@render children()}