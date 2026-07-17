import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-abaco-de-harrison',
    version: '1.0.2',
    title: 'Pronóstico de Viento Zonda',
    icon: '🌡️',
    description:
        'Diagnóstico de viento Zonda con el Ábaco de Harrison: diferencia de QNH ' +
        'SCEL–SAME vs. componente de viento perpendicular a la cordillera en 500 hPa (~FL180).',
    author: 'Francisco J. Ramos Francés · fcoramos@gmail.com',
    repository: 'https://github.com/fcoramos/windy-plugin-abaco-de-harrison',
    desktopUI: 'rhpane',
    mobileUI: 'fullscreen',
    routerPath: '/abaco-de-harrison',
    desktopWidth: 820,
};

export default config;
