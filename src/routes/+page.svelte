<script lang="ts">
	import Player from '$lib/Player.svelte';

	let ready = $state(false);
</script>

<div class="backdrop"></div>
<div class="app" class:ready>
	<Player on:ready={() => (ready = true)} />
</div>