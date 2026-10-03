package com.getaop.mobile.ui.main

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.MutableThreePaneScaffoldState
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth
import androidx.compose.material3.adaptive.navigation.BackNavigationBehavior
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getaop.mobile.ui.chat.ChatPane
import com.getaop.mobile.ui.common.ConnectionBanner
import com.getaop.mobile.ui.settings.SettingsSheet
import com.getaop.mobile.ui.thread.ThreadPane
import kotlinx.coroutines.launch

/**
 * The app once paired, as one list-detail layout that follows the window, never the device:
 * - Cover screen, a narrow split-screen window or a phone: one pane at a time. The list (all
 *   projects, then one project's coordinator and threads) leads to a conversation, and back
 *   (with Android's predictive back gesture) returns.
 * - Unfolded (600 dp and wider, which the Fold8's inner screen is either way up): the list on the
 *   left and the conversation on the right. Half-folded, the panes meet at the hinge instead of
 *   straddling it.
 * Folding or unfolding re-lays out the same state: the open project, conversation and drafts stay.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun MainScreen(viewModel: MainViewModel) {
    val host by viewModel.host.collectAsStateWithLifecycle()
    val hostName by viewModel.hostName.collectAsStateWithLifecycle()
    val selected by viewModel.selectedProject.collectAsStateWithLifecycle()
    var showSettings by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val directive = calculatePaneScaffoldDirectiveWithTwoPanesOnMediumWidth(currentWindowAdaptiveInfoV2())
    val navigator = rememberListDetailPaneScaffoldNavigator<Detail>(scaffoldDirective = directive)
    val twoPanes = directive.maxHorizontalPartitions > 1
    val current = navigator.currentDestination?.contentKey

    // The navigator recomputes which panes fit when the window changes size, but applies it only on
    // its next navigation; folding or unfolding is not one, so the new layout is applied here.
    val fitted = navigator.scaffoldValue
    LaunchedEffect(fitted) {
        (navigator.scaffoldState as? MutableThreePaneScaffoldState)?.snapTo(fitted)
    }
    LaunchedEffect(viewModel) {
        viewModel.opens.collect { request -> navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, request.detail) }
    }
    // Unfolded, a project opens on its coordinator chat, so the right pane is never empty for no reason.
    LaunchedEffect(selected, twoPanes) {
        val project = selected ?: return@LaunchedEffect
        if (twoPanes && current?.projectId != project) {
            navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, Detail(project, null))
        }
    }

    val openDetail: (Detail) -> Unit = { detail -> scope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, detail) } }

    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top))) {
        ConnectionBanner(host.connection, hostName, onRetry = viewModel::retry, onPairAgain = viewModel::pairAgain)
        NavigableListDetailPaneScaffold(
            navigator = navigator,
            defaultBackBehavior = BackNavigationBehavior.PopUntilScaffoldValueChange,
            listPane = {
                AnimatedPane {
                    val project = selected?.let(host::project)
                    BackHandler(enabled = project != null && !navigator.canNavigateBack(BackNavigationBehavior.PopUntilScaffoldValueChange)) {
                        viewModel.selectProject(null)
                    }
                    if (project == null) {
                        ProjectsPane(
                            host = host,
                            hostName = hostName,
                            onOpenProject = viewModel::selectProject,
                            onOpenSettings = { showSettings = true },
                        )
                    } else {
                        ProjectPane(
                            host = host,
                            project = project,
                            selected = current,
                            onBack = { viewModel.selectProject(null) },
                            onOpen = openDetail,
                            onOpenSettings = { showSettings = true },
                        )
                    }
                }
            },
            detailPane = {
                AnimatedPane {
                    val detail = current
                    when {
                        detail == null -> EmptyDetail(if (selected == null) "Pick a project" else "Open the coordinator chat or a thread")
                        detail.threadId == null -> ChatPane(viewModel, host, detail, showBack = !twoPanes, onBack = { scope.launch { navigator.navigateBack() } }, onOpen = viewModel::open)
                        else -> ThreadPane(viewModel, host, detail, showBack = !twoPanes, onBack = { scope.launch { navigator.navigateBack() } }, onOpen = viewModel::open)
                    }
                }
            },
            modifier = Modifier.weight(1f),
        )
    }

    if (showSettings) {
        SettingsSheet(viewModel, hostName, onDismiss = { showSettings = false })
    }
}

@Composable
private fun EmptyDetail(text: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
